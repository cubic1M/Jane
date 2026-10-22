import { createHash } from "node:crypto";
import {
  FILINGS_LOOKBACK_DAYS,
  NEWS_BATCH_SIZE,
  NEWS_CALLS_PER_DAY,
  NEWS_FILING_FORMS,
  NEWS_INPUT_TOKENS_FIXED,
  NEWS_INPUT_TOKENS_PER_HEADLINE,
  NEWS_LOOKBACK_DAYS,
  NEWS_MAX_OUTPUT_TOKENS,
  NEWS_MONTHLY_CAP_CENTS_DEFAULT,
} from "@/config/news";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { costInHundredthsOfCents } from "@/lib/jane-agent/spend";
import { WATCH_CIKS, marketData, MarketDataNotConfigured } from "@/lib/market";
import type { Filing, Headline, MarketData } from "@/lib/market";
import { PRACTICE_TICKERS } from "@/lib/market/sample";
import {
  batchIds,
  claudeSummarizer,
  isApiError,
  newsLlmEnabled,
  newsModel,
  rulesSummary,
  summaryOk,
  type Summarizer,
} from "./summarize";

// The news job (spec step 293): once a day it reads the watchlist's headlines and filings from
// the market data, summarises the headlines it hasn't stored yet (Claude in a few batched calls
// when the news model is set and the month's cap allows, the rules otherwise) and stores them.
// The chat and pages read what is stored (./read.ts) and never call anyone.

type Options = {
  client?: PrismaClient;
  now?: Date;
  market?: MarketData;
  summarizer?: Summarizer;
  env?: Record<string, string | undefined>;
};

const DAY_MS = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (now: Date, days: number) => day(new Date(now.getTime() - days * DAY_MS));
const dayStart = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// The practice portfolios' ETFs and the large companies the market data watches.
export const NEWS_WATCHLIST: readonly string[] = [
  ...new Set([...PRACTICE_TICKERS, ...Object.keys(WATCH_CIKS)]),
];

export function newsCapCents(env: Record<string, string | undefined> = process.env): number {
  const set = Number(env.NEWS_MONTHLY_CAP_CENTS);
  return Number.isFinite(set) && set > 0 ? set : NEWS_MONTHLY_CAP_CENTS_DEFAULT;
}

export const newsKey = (
  feed: string,
  kind: "headline" | "filing",
  item: { date: string; ticker: string | null; title: string; form?: string },
) =>
  createHash("sha256")
    .update([feed, kind, item.date, item.ticker ?? "", item.form ?? "", item.title].join("\n"))
    .digest("hex");

// The most one call for `headlines` headlines could cost, in hundredths of a cent.
export function worstCaseHundredths(model: string, headlines: number): number {
  return costInHundredthsOfCents({
    model,
    inputTokens: NEWS_INPUT_TOKENS_FIXED + headlines * NEWS_INPUT_TOKENS_PER_HEADLINE,
    outputTokens: NEWS_MAX_OUTPUT_TOKENS,
  });
}

export async function newsSpend({ client = defaultClient, now = new Date() }: Options = {}) {
  const [month, today] = await Promise.all([
    client.newsSummaryCall.aggregate({
      where: { calledAt: { gte: monthStart(now) } },
      _sum: { costHundredths: true },
    }),
    client.newsSummaryCall.count({ where: { calledAt: { gte: dayStart(now) } } }),
  ]);
  return { monthHundredths: month._sum.costHundredths ?? 0, callsToday: today };
}

// Why a call may not be made now, or null when it may: no key or model, today's calls used, or
// the call could take the month past the cap.
export async function callBlocked(
  headlines: number,
  options: Options = {},
): Promise<"off" | "daily_calls" | "monthly_cap" | null> {
  const env = options.env ?? process.env;
  const model = newsModel(env);
  if (!newsLlmEnabled(env) || !model) return "off";
  const { monthHundredths, callsToday } = await newsSpend(options);
  if (callsToday >= NEWS_CALLS_PER_DAY) return "daily_calls";
  if (monthHundredths + worstCaseHundredths(model, headlines) > newsCapCents(env) * 100) {
    return "monthly_cap";
  }
  return null;
}

export type NewsRun = {
  feed: string;
  headlines: number;
  stored: number;
  byClaude: number;
  byRules: number;
  filings: number;
  calls: number;
  // Why Claude wasn't (or stopped being) asked, when it wasn't.
  skipped: "off" | "daily_calls" | "monthly_cap" | null;
};

async function filingsFor(market: MarketData, from: string, to: string): Promise<Filing[]> {
  const forms = new Set<string>(NEWS_FILING_FORMS);
  const out: Filing[] = [];
  for (const ticker of Object.keys(WATCH_CIKS)) {
    try {
      out.push(...(await market.filings(ticker, from, to)).filter((f) => forms.has(f.form)));
    } catch (error) {
      // EDGAR without its User-Agent: no filings, the rest of the run goes on.
      if (!(error instanceof MarketDataNotConfigured)) throw error;
    }
  }
  return out;
}

export async function runNews(options: Options = {}): Promise<NewsRun> {
  const client = options.client ?? defaultClient;
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const market = options.market ?? marketData(env);
  const summarizer = options.summarizer ?? claudeSummarizer;
  const to = day(now);

  const [headlines, filings] = await Promise.all([
    market.news(NEWS_WATCHLIST, daysBefore(now, NEWS_LOOKBACK_DAYS), to),
    filingsFor(market, daysBefore(now, FILINGS_LOOKBACK_DAYS), to),
  ]);

  // Filings are facts with a link: stored as they are.
  let filingsStored = 0;
  for (const f of filings) {
    const created = await client.marketNews.createMany({
      data: [
        {
          key: newsKey(market.name, "filing", f),
          feed: market.name,
          kind: "filing",
          ticker: f.ticker,
          date: new Date(`${f.date}T00:00:00Z`),
          title: f.title,
          source: "SEC EDGAR",
          url: f.url,
          form: f.form,
        },
      ],
      skipDuplicates: true,
    });
    filingsStored += created.count;
  }

  // Only the headlines not stored yet are summarised: a headline costs one summary, ever.
  const keyed = headlines.map((h) => ({ h, key: newsKey(market.name, "headline", h) }));
  const known = new Set(
    (
      await client.marketNews.findMany({
        where: { key: { in: keyed.map((k) => k.key) } },
        select: { key: true },
      })
    ).map((r) => r.key),
  );
  const fresh = [
    ...new Map(keyed.filter((k) => !known.has(k.key)).map((k) => [k.key, k])).values(),
  ];

  const run: NewsRun = {
    feed: market.name,
    headlines: headlines.length,
    stored: 0,
    byClaude: 0,
    byRules: 0,
    filings: filingsStored,
    calls: 0,
    skipped: null,
  };

  for (let i = 0; i < fresh.length; i += NEWS_BATCH_SIZE) {
    const batch = fresh.slice(i, i + NEWS_BATCH_SIZE);
    const fromClaude = await summariseWithClaude(
      batch.map((b) => b.h),
      { client, now, env, summarizer },
      run,
    );
    for (const [j, { h, key }] of batch.entries()) {
      const claude = fromClaude?.[j];
      const ok = claude != null && summaryOk(claude, h);
      const created = await client.marketNews.createMany({
        data: [
          {
            key,
            feed: market.name,
            kind: "headline",
            ticker: h.ticker,
            date: new Date(`${h.date}T00:00:00Z`),
            title: h.title,
            source: h.source,
            url: h.url,
            summary: ok ? claude : rulesSummary(h),
            summaryBy: ok ? "claude" : "rules",
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0) continue;
      run.stored += 1;
      if (ok) run.byClaude += 1;
      else run.byRules += 1;
    }
  }
  return run;
}

// One batch through Claude when it may be asked: the call is written down first with the most it
// could cost (so a crash mid-call still counts against the cap), then set to what it cost.
// Returns each headline's summary by position, or null when Claude wasn't asked or failed.
async function summariseWithClaude(
  batch: Headline[],
  {
    client,
    now,
    env,
    summarizer,
  }: Required<Pick<Options, "client" | "now" | "env" | "summarizer">>,
  run: NewsRun,
): Promise<(string | undefined)[] | null> {
  const blocked = await callBlocked(batch.length, { client, now, env });
  if (blocked) {
    run.skipped = blocked;
    return null;
  }
  const model = newsModel(env)!;
  const call = await client.newsSummaryCall.create({
    data: {
      calledAt: now,
      model,
      headlines: batch.length,
      costHundredths: worstCaseHundredths(model, batch.length),
    },
  });
  run.calls += 1;
  try {
    const result = await summarizer(batch, model);
    await client.newsSummaryCall.update({
      where: { id: call.id },
      data: {
        ok: true,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costHundredths: costInHundredthsOfCents({ model, ...result.usage }),
      },
    });
    return batchIds(batch).map((id) => result.summaries.get(id));
  } catch (error) {
    if (!isApiError(error)) throw error;
    console.error("News summaries failed", { status: (error as { status?: number }).status });
    return null;
  }
}
