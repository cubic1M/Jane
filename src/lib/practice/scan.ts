import {
  classTickers,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import { ON_OPEN_SCAN_MINUTES } from "@/config/practice-opportunities";
import { ideaSlot, PRACTICE_IDEA_DAYS } from "@/config/practice-suggestions";
import { NEWS_LOOKBACK_DAYS, SCAN_HISTORY_DAYS, type ScanKind } from "@/config/practice-scan";
import { loadDetectionInput } from "@/detection/engine";
import { paySchedules } from "@/detection/paydays";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { THEME_NEWS_SYMBOLS } from "@/config/themes";
import { postThemeAlertsSafely } from "./theme-alerts";
import { marketData, type Bar, type Headline } from "@/lib/market";
import { newsKey } from "@/lib/news/store";
import { rulesSummary } from "@/lib/news/summarize";
import { mainPaydayDay, scanOpportunities } from "@/planning/practice-opportunities";
import { firstRefusal, refusedByPreferences } from "@/planning/practice-profile";
import { flagStatus, monthUse, notAskedYet, type ScanHeadline } from "@/planning/practice-scan";
import { addMonthlyIfDue, runAutopilot } from "./autopilot";
import { loadLedger, NoPracticePortfolio, practiceBroker } from "./broker";
import { scanPreferences } from "./opportunity-prefs";
import { practiceProfileOf } from "./preferences";

// The daily scan of each practice portfolio (spec step 292, Phase AW, Stage A), run by Vercel
// Cron (/api/cron/practice-scan). For each portfolio that isn't paused: the monthly practice
// money goes in, the scan flags drift, dips, losses to harvest and (High and Very high, with
// opportunities on) news ideas, Jane acts on each in the practice ledger within its caps and the
// autopilot's hard limits, then the autopilot rebalances. Every flag is kept with its numbers,
// caps and confidence for the cards (step 296). Practice money only: nothing is a real order.
//
// After step 292 the scan also looks for the kinds in src/planning/practice-opportunities.ts
// (new money, idle cash, cheaper twins, payday timing, drift and risk warnings, the glide path)
// and obeys the person's preferences: in suggest-only mode nothing is traded and every flag is
// kept as "suggested" for the suggestions pipeline. Ideas are for demo advice mode only: a
// person with a real account gets the autopilot's own rebalance and nothing else
// (REAL_ACCOUNT_ADVICE is false).

type Options = { client?: PrismaClient; now?: Date };
// `act: false` is the cheap scan on opening a page: nothing is traded or held, and a flag
// with trades is only recorded when the person is in suggest-only mode (otherwise the daily
// run acts on it).
type ScanOptions = Options & { act?: boolean };

export type ScanOutcome = {
  kind: ScanKind;
  ticker: string;
  // acted: traded in the practice ledger; autopilot: the autopilot's own rebalance; held: a
  // cap stopped it; suggested: waiting for the person (suggest-only mode, or a kind that only
  // ever suggests).
  status: "acted" | "autopilot" | "held" | "suggested";
  trades: number;
};

export type ScanResult =
  { scanned: false; why: "no_portfolio" | "paused" } | { scanned: true; flags: ScanOutcome[] };

const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

// Step 293's summary for each headline: the stored one (Claude's, checked, or the rules one),
// else the rules summary made here. No call out.
async function withSummaries(
  headlines: readonly Headline[],
  feed: string,
  client: PrismaClient,
): Promise<ScanHeadline[]> {
  const keyed = headlines.map((h) => ({ h, key: newsKey(feed, "headline", h) }));
  const rows =
    keyed.length > 0
      ? await client.marketNews.findMany({
          where: { key: { in: keyed.map((k) => k.key) } },
          select: { key: true, summary: true, summaryBy: true },
        })
      : [];
  const stored = new Map(rows.map((r) => [r.key, r]));
  return keyed.map(({ h, key }) => {
    const row = stored.get(key);
    return row?.summary
      ? { ...h, summary: row.summary, summaryBy: row.summaryBy === "claude" ? "claude" : "rules" }
      : { ...h, summary: rulesSummary(h), summaryBy: "rules" };
  });
}

// The day of the month the person is usually paid, from their deposits; null when unknown.
async function paydayDayOf(userId: string, client: PrismaClient, now: Date) {
  try {
    return mainPaydayDay(paySchedules(await loadDetectionInput(userId, { client, now })));
  } catch (error) {
    console.error("Practice scan: paydays unavailable", { error: String(error) });
    return null;
  }
}

export async function scanPractice(
  userId: string,
  { client = defaultClient, now = new Date(), act = true }: ScanOptions = {},
): Promise<ScanResult> {
  let ledger;
  try {
    ledger = await loadLedger(userId, client);
  } catch (error) {
    if (error instanceof NoPracticePortfolio) return { scanned: false, why: "no_portfolio" };
    throw error;
  }
  const { portfolio, state } = ledger;
  // Pausing takes effect before the next scan (step 294).
  if (portfolio.paused) return { scanned: false, why: "paused" };
  // Following a tested strategy (src/planning/catalog-follow.ts): its rule runs the portfolio,
  // so the scan's upkeep and extra moves wait.
  if ((await practiceProfileOf(userId, { client, now })).catalog) return { scanned: true, flags: [] };

  const today = now.toISOString().slice(0, 10);
  const feed = marketData();
  const prices: Record<string, number> = {};
  for (const ticker of PRACTICE_UNIVERSE) {
    const bar = await feed.latest(ticker, today);
    if (bar) prices[ticker] = bar.closeCents;
  }
  const from = daysBefore(today, SCAN_HISTORY_DAYS);
  const history: Record<string, Bar[]> = {};
  for (const c of Object.keys(PRACTICE_ETFS) as PracticeClass[]) {
    for (const ticker of classTickers(c)) history[ticker] = await feed.prices(ticker, from, today);
  }
  const heldHistory: Record<string, Bar[]> = {};
  for (const ticker of Object.keys(state.positions)) {
    if (!history[ticker]) heldHistory[ticker] = await feed.prices(ticker, from, today);
  }
  const headlines = await withSummaries(
    // The watched companies, and the news themes' funds and companies (src/config/themes.ts).
    await feed.news(
      [...PRACTICE_STOCKS, ...THEME_NEWS_SYMBOLS],
      daysBefore(today, NEWS_LOOKBACK_DAYS),
      today,
    ),
    feed.name,
    client,
  );
  // The person's preferences (src/planning/practice-profile.ts): the mix, the caps their
  // appetite allows, what is never bought, the cash kept and whether Jane acts.
  const profile = await practiceProfileOf(userId, { client, now });
  const [prefs, advice, paydayDay] = await Promise.all([
    scanPreferences(userId, { client, now }),
    adviceMode(userId, { client }),
    act && portfolio.monthlyAddCents > 0 ? paydayDayOf(userId, client, now) : Promise.resolve(null),
  ]);

  const db = scopedFor(userId, client);
  const trades = await db.practiceTrades.findMany({
    where: { portfolioId: portfolio.id, undone: false, side: { in: ["buy", "sell"] } },
    select: {
      placedAt: true,
      side: true,
      ticker: true,
      quantity: true,
      amountCents: true,
      gainCents: true,
      rule: true,
    },
  });
  const past = await db.practiceOpportunities.findMany({
    where: { portfolioId: portfolio.id },
    select: { key: true, kind: true, ticker: true, scannedAt: true, status: true },
  });
  // What the person is still being asked about: not asked again while it waits.
  const waitingSince = new Date(now.getTime() - PRACTICE_IDEA_DAYS * 86_400_000);
  const waiting = new Set(
    past
      .filter((p) => p.status === "suggested" && p.scannedAt >= waitingSince)
      .map((p) => ideaSlot(p.kind, p.ticker)),
  );
  const lastDeposit = await db.practiceTrades.findFirst({
    where: { portfolioId: portfolio.id, undone: false, side: "deposit" },
    orderBy: { placedAt: "desc" },
    select: { placedAt: true },
  });
  const { usedThisMonth, seen } = monthUse(
    past.map((p) => ({ ...p, scannedAt: p.scannedAt.toISOString() })),
    today,
  );

  const found = scanOpportunities({
    level: profile.level,
    state,
    weights: profile.weights,
    caps: profile.caps,
    opportunityMaxShare: profile.opportunityMaxShare,
    avoid: profile.avoid,
    cashBufferCents: profile.cashBufferCents,
    limits: profile.limits,
    funds: profile.funds,
    prices,
    history,
    trades: trades.map((t) => ({ ...t, placedAt: t.placedAt.toISOString() })),
    headlines,
    today,
    opportunitiesPaused: portfolio.opportunitiesPaused,
    usedThisMonth,
    seen,
    prefs,
    monthlyAddCents: portfolio.monthlyAddCents,
    addDay: portfolio.addDay,
    paydayDay,
    heldHistory,
    lastDepositOn: lastDeposit?.placedAt.toISOString().slice(0, 10) ?? null,
  });
  // A real account gets no ideas: only the autopilot's own rebalance.
  const flags = advice ? found : found.filter((f) => f.kind === "drift_rebalance");

  const dayStart = new Date(`${today}T00:00:00Z`);
  const broker = practiceBroker();
  const outcomes: ScanOutcome[] = [];
  for (const flag of flags) {
    if (!act && flag.trades.length > 0 && prefs.mode === "act") continue;
    const current = await loadLedger(userId, client);
    const tradesToday = await db.practiceTrades.count({
      where: {
        portfolioId: portfolio.id,
        side: { in: ["buy", "sell"] },
        undone: false,
        placedAt: { gte: dayStart },
      },
    });
    // The preferences' last check (never-buy list), then the hard limits.
    const { status, heldBy: held } = flagStatus(
      flag,
      current.state,
      prices,
      tradesToday,
      prefs.mode,
      firstRefusal(profile, flag),
      profile.limits,
    );
    if (!act && held) continue;
    // One question at a time about the same thing, and none about pocket change.
    if (status === "suggested" && notAskedYet(flag, waiting)) continue;
    const details = {
      figures: flag.figures,
      caps: flag.caps,
      confidence: flag.confidence,
      ask: flag.ask,
      heldBy: held,
      mode: prefs.mode,
      trades: flag.trades.map((t) => ({
        ticker: t.ticker,
        side: t.side,
        amountCents: t.amountCents,
      })),
    };
    // Claims the key first, so two runs at once act once.
    const { count } = await db.practiceOpportunities.createMany({
      data: [
        {
          portfolioId: portfolio.id,
          userId,
          scannedAt: now,
          kind: flag.kind,
          ticker: flag.ticker,
          key: held ? `${flag.key}:held:${today}` : flag.key,
          amountCents: flag.amountCents,
          headline: flag.headline,
          reason: flag.reason,
          confidence: flag.confidence.percent,
          details: details as Prisma.InputJsonValue,
          status,
          tradeIds: [],
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0 || status !== "acted") {
      if (count > 0) outcomes.push({ kind: flag.kind, ticker: flag.ticker, status, trades: 0 });
      continue;
    }
    const tradeIds: string[] = [];
    for (const t of flag.trades) {
      if (refusedByPreferences(profile, t)) continue;
      const fill = await broker.placeOrder(
        userId,
        {
          ticker: t.ticker,
          side: t.side,
          amountCents: t.amountCents,
          reason: t.reason,
          rule: t.rule,
        },
        { client, now },
      );
      tradeIds.push(fill.tradeId);
    }
    await db.practiceOpportunities.updateMany({
      where: { portfolioId: portfolio.id, key: flag.key },
      data: { tradeIds },
    });
    outcomes.push({ kind: flag.kind, ticker: flag.ticker, status, trades: tradeIds.length });
  }
  return { scanned: true, flags: outcomes };
}

// Constant search: the cheap scan when the person opens the chat or the investing pages, at
// most once every ON_OPEN_SCAN_MINUTES. Null when there's nothing to scan or it ran lately.
export async function scanOnOpen(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ScanResult | null> {
  const portfolio = await scopedFor(userId, client).practicePortfolios.findFirst({
    select: { id: true, paused: true },
  });
  if (!portfolio || portfolio.paused) return null;
  const since = new Date(now.getTime() - ON_OPEN_SCAN_MINUTES * 60_000);
  const { count } = await client.practicePortfolio.updateMany({
    where: {
      id: portfolio.id,
      userId,
      OR: [{ lightScannedAt: null }, { lightScannedAt: { lt: since } }],
    },
    data: { lightScannedAt: now },
  });
  if (count === 0) return null;
  return scanPractice(userId, { client, now, act: false });
}

// Opening a page never waits on, or fails with, the scan.
export async function scanOnOpenQuietly(userId: string) {
  try {
    await scanOnOpen(userId);
  } catch (error) {
    console.error("Practice scan on open failed", { error: String(error) });
  }
  // A news theme's idea found today goes out as an alert (src/lib/practice/theme-alerts.ts).
  await postThemeAlertsSafely(userId);
}

// One portfolio's day: the monthly money in, the scan, then the autopilot.
export async function runPracticeDay(userId: string, options: Options = {}) {
  try {
    await addMonthlyIfDue(userId, options);
  } catch (error) {
    if (error instanceof NoPracticePortfolio) return null;
    throw error;
  }
  const scan = await scanPractice(userId, options);
  const autopilot = await runAutopilot(userId, options);
  return { scan, autopilot };
}

// Every practice portfolio that isn't paused. One person's problem never stops the rest.
export async function runPracticeDayForAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  const rows = await client.practicePortfolio.findMany({
    where: { paused: false },
    select: { userId: true },
  });
  let flags = 0;
  let trades = 0;
  let failed = 0;
  for (const { userId } of rows) {
    try {
      const day = await runPracticeDay(userId, { client, now });
      await postThemeAlertsSafely(userId, { client, now });
      if (day?.scan.scanned) flags += day.scan.flags.length;
      if (day?.scan.scanned) trades += day.scan.flags.reduce((s, f) => s + f.trades, 0);
      if (day?.autopilot.ran) trades += day.autopilot.fills.length;
    } catch (error) {
      failed += 1;
      console.error("Practice scan failed", { error: String(error) });
    }
  }
  return { portfolios: rows.length, flags, trades, failed };
}
