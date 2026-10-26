import {
  FILINGS_LOOKBACK_DAYS,
  NEWS_FILING_FORMS,
  NEWS_LOOKBACK_DAYS,
  NEWS_TOOL_MAX_FILINGS,
  NEWS_TOOL_MAX_HEADLINES,
} from "@/config/news";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { WATCH_CIKS, marketData, type MarketData } from "@/lib/market";
import { NEWS_WATCHLIST, newsKey } from "./store";
import { rulesSummary } from "./summarize";
import { DAY_MS, isoDay as day } from "@/lib/dates";

// What the chat and pages show of the news (spec step 293): the stored summaries and filings
// for the market data in use, newest first. Nothing here calls Claude or a live feed. On the
// sample market, what the daily job hasn't stored yet is read from the sample (in memory, so
// free too), each headline with its rules summary.

type Options = { client?: PrismaClient; now?: Date; market?: MarketData };

export type NewsHeadline = {
  ticker: string | null;
  date: string;
  title: string;
  source: string;
  url: string | null;
  summary: string;
  summaryBy: "claude" | "rules";
};
export type NewsFiling = {
  ticker: string;
  date: string;
  form: string;
  title: string;
  url: string | null;
};
export type NewsView = {
  feed: string;
  simulated: boolean;
  headlines: NewsHeadline[];
  filings: NewsFiling[];
};

const since = (now: Date, days: number) => new Date(Date.parse(day(now)) - days * DAY_MS);
const newestFirst = <T extends { date: string }>(a: T, b: T) => b.date.localeCompare(a.date);

export async function loadNews({
  client = defaultClient,
  now = new Date(),
  market = marketData(),
}: Options = {}): Promise<NewsView> {
  const tickers = new Set(NEWS_WATCHLIST);
  const rows = await client.marketNews.findMany({
    where: {
      feed: market.name,
      OR: [
        { kind: "headline", date: { gte: since(now, NEWS_LOOKBACK_DAYS), lte: now } },
        { kind: "filing", date: { gte: since(now, FILINGS_LOOKBACK_DAYS), lte: now } },
      ],
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const headlines: NewsHeadline[] = rows
    .filter((r) => r.kind === "headline" && r.summary && (!r.ticker || tickers.has(r.ticker)))
    .map((r) => ({
      ticker: r.ticker,
      date: day(r.date),
      title: r.title,
      source: r.source,
      url: r.url,
      summary: r.summary!,
      summaryBy: r.summaryBy === "claude" ? "claude" : "rules",
    }));
  const filings: NewsFiling[] = rows
    .filter((r) => r.kind === "filing" && r.ticker && r.form)
    .map((r) => ({
      ticker: r.ticker!,
      date: day(r.date),
      form: r.form!,
      title: r.title,
      url: r.url,
    }));

  if (market.simulated) {
    const stored = new Set(
      rows.map((r) =>
        newsKey(market.name, r.kind === "filing" ? "filing" : "headline", {
          date: day(r.date),
          ticker: r.ticker,
          title: r.title,
          form: r.form ?? undefined,
        }),
      ),
    );
    const to = day(now);
    for (const h of await market.news(NEWS_WATCHLIST, day(since(now, NEWS_LOOKBACK_DAYS)), to)) {
      if (stored.has(newsKey(market.name, "headline", h))) continue;
      headlines.push({ ...h, summary: rulesSummary(h), summaryBy: "rules" });
    }
    const forms = new Set<string>(NEWS_FILING_FORMS);
    for (const ticker of Object.keys(WATCH_CIKS)) {
      for (const f of await market.filings(ticker, day(since(now, FILINGS_LOOKBACK_DAYS)), to)) {
        if (!forms.has(f.form) || stored.has(newsKey(market.name, "filing", f))) continue;
        filings.push({ ticker: f.ticker, date: f.date, form: f.form, title: f.title, url: f.url });
      }
    }
  }

  return {
    feed: market.name,
    simulated: market.simulated,
    headlines: headlines.sort(newestFirst).slice(0, NEWS_TOOL_MAX_HEADLINES),
    filings: filings.sort(newestFirst).slice(0, NEWS_TOOL_MAX_FILINGS),
  };
}
