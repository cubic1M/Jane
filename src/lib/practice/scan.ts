import type { RiskLevel } from "@/config/investing";
import {
  classTickers,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import { NEWS_LOOKBACK_DAYS, SCAN_HISTORY_DAYS, type ScanKind } from "@/config/practice-scan";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData, type Bar } from "@/lib/market";
import { flagStatus, monthUse, scanPortfolio } from "@/planning/practice-scan";
import { addMonthlyIfDue, runAutopilot } from "./autopilot";
import { loadLedger, NoPracticePortfolio, practiceBroker } from "./broker";

// The daily scan of each practice portfolio (spec step 292, Phase AW, Stage A), run by Vercel
// Cron (/api/cron/practice-scan). For each portfolio that isn't paused: the monthly practice
// money goes in, the scan flags drift, dips, losses to harvest and (High and Very high, with
// opportunities on) news ideas, Jane acts on each in the practice ledger within its caps and the
// autopilot's hard limits, then the autopilot rebalances. Every flag is kept with its numbers,
// caps and confidence for the cards (step 296). Practice money only: nothing is a real order.

type Options = { client?: PrismaClient; now?: Date };

export type ScanOutcome = {
  kind: ScanKind;
  ticker: string;
  status: "acted" | "autopilot" | "held";
  trades: number;
};

export type ScanResult =
  { scanned: false; why: "no_portfolio" | "paused" } | { scanned: true; flags: ScanOutcome[] };

const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

export async function scanPractice(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
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
  const headlines = await feed.news(PRACTICE_STOCKS, daysBefore(today, NEWS_LOOKBACK_DAYS), today);

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
    select: { key: true, kind: true, scannedAt: true, status: true },
  });
  const { usedThisMonth, seen } = monthUse(
    past.map((p) => ({ ...p, scannedAt: p.scannedAt.toISOString() })),
    today,
  );

  const flags = scanPortfolio({
    level: portfolio.level as RiskLevel,
    state,
    prices,
    history,
    trades: trades.map((t) => ({ ...t, placedAt: t.placedAt.toISOString() })),
    headlines,
    today,
    opportunitiesPaused: portfolio.opportunitiesPaused,
    usedThisMonth,
    seen,
  });

  const dayStart = new Date(`${today}T00:00:00Z`);
  const broker = practiceBroker();
  const outcomes: ScanOutcome[] = [];
  for (const flag of flags) {
    const current = await loadLedger(userId, client);
    const tradesToday = await db.practiceTrades.count({
      where: {
        portfolioId: portfolio.id,
        side: { in: ["buy", "sell"] },
        undone: false,
        placedAt: { gte: dayStart },
      },
    });
    const { status, heldBy: held } = flagStatus(flag, current.state, prices, tradesToday);
    const details = {
      figures: flag.figures,
      caps: flag.caps,
      confidence: flag.confidence,
      heldBy: held,
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
