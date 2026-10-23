import { PRACTICE_UNIVERSE } from "@/config/portfolios";
import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData } from "@/lib/market";
import {
  monthlyDue,
  planTrades,
  sellsFirst,
  type PlannedTrade,
} from "@/planning/practice-autopilot";
import { refusedByPreferences } from "@/planning/practice-profile";
import { washBlocked } from "@/planning/practice-scan";
import { replay, type Entry } from "@/planning/practice-ledger";
import { practiceBroker, loadLedger, type Fill } from "./broker";
import { addPracticeMoney, PracticeError } from "./portfolio";
import { practiceProfileOf } from "./preferences";

// Autopilot for the practice portfolio (spec steps 291 and 294, Phase AW, Stage A): once a level
// is chosen Jane buys the model, rebalances past the band and adds the monthly practice money,
// in the paper ledger only. A pause switch stops it before the next run; every trade has a reason
// and a rule and is audit-logged; the person can see the log and undo the last trade. Nothing here
// touches a real account.

type Options = { client?: PrismaClient; now?: Date };

// In suggest-only mode (the person's preferences) the plan comes back as `suggested` and nothing
// is placed.
export type RunResult =
  | { ran: false; why: "no_portfolio" | "paused" }
  | { ran: true; deposit: boolean; fills: Fill[]; suggested: PlannedTrade[] };

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

// The monthly practice money, once a month, on or after the chosen day. True when it went in.
// The daily run puts it in before the scan (step 292), so a dip can use it first.
export async function addMonthlyIfDue(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const { portfolio } = await loadLedger(userId, client);
  if (portfolio.paused) return false;
  const today = now.toISOString().slice(0, 10);
  const due = { ...portfolio, today, addedThisMonth: false };
  if (!monthlyDue(due)) return false;
  const added = await client.practiceTrade.findFirst({
    where: {
      portfolioId: portfolio.id,
      side: "deposit",
      rule: "monthly_add",
      undone: false,
      placedAt: { gte: new Date(`${monthKey(now)}-01T00:00:00Z`) },
    },
    select: { id: true },
  });
  if (!monthlyDue({ ...due, addedThisMonth: added !== null })) return false;
  await addPracticeMoney(
    userId,
    portfolio.monthlyAddCents,
    "Your monthly practice money.",
    "monthly_add",
    { client, now },
  );
  return true;
}

export async function runAutopilot(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RunResult> {
  let ledger;
  try {
    ledger = await loadLedger(userId, client);
  } catch {
    return { ran: false, why: "no_portfolio" };
  }
  const { portfolio } = ledger;
  if (portfolio.paused) return { ran: false, why: "paused" };

  const deposit = await addMonthlyIfDue(userId, { client, now });

  const { state } = await loadLedger(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const feed = marketData();
  const prices: Record<string, number> = {};
  for (const ticker of PRACTICE_UNIVERSE) {
    const bar = await feed.latest(ticker, asOf);
    if (bar) prices[ticker] = bar.closeCents;
  }
  const dayStart = new Date(`${asOf}T00:00:00Z`);
  const tradesToday = await client.practiceTrade.count({
    where: {
      portfolioId: portfolio.id,
      side: { in: ["buy", "sell"] },
      undone: false,
      placedAt: { gte: dayStart },
    },
  });
  // Funds sold at a loss lately aren't bought back (no wash sale).
  const recent = await client.practiceTrade.findMany({
    where: {
      portfolioId: portfolio.id,
      side: "sell",
      undone: false,
      placedAt: { gte: new Date(dayStart.getTime() - (WASH_SALE_DAYS + 1) * 86_400_000) },
    },
    select: { placedAt: true, side: true, ticker: true, gainCents: true },
  });
  const sold = recent.map((t) => ({ ...t, placedAt: t.placedAt.toISOString() }));
  const blocked = washBlocked(sold, asOf);
  // The person's preferences: the mix, what is never bought, the cash kept and whether Jane acts.
  const profile = await practiceProfileOf(userId, { client, now });
  const plan = planTrades({
    level: profile.level,
    state,
    prices,
    paused: false,
    tradesToday,
    blocked,
    weights: profile.weights,
    avoid: new Set(profile.avoid),
    cashBufferCents: profile.cashBufferCents,
  });
  if (!profile.trades) return { ran: true, deposit, fills: [], suggested: plan };
  const broker = practiceBroker();
  const fills: Fill[] = [];
  for (const t of sellsFirst(plan)) {
    if (refusedByPreferences(profile, t)) continue;
    fills.push(
      await broker.placeOrder(
        userId,
        {
          ticker: t.ticker,
          side: t.side,
          amountCents: t.amountCents,
          reason: t.reason,
          rule: t.rule,
        },
        { client, now },
      ),
    );
  }
  return { ran: true, deposit, fills, suggested: [] };
}

// Every portfolio, for the daily run (step 292 calls this beside the scan). One person's problem
// never stops the rest.
export async function runAutopilotForAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  const rows = await client.practicePortfolio.findMany({
    where: { paused: false },
    select: { userId: true },
  });
  let trades = 0;
  for (const { userId } of rows) {
    try {
      const r = await runAutopilot(userId, { client, now });
      if (r.ran) trades += r.fills.length;
    } catch (error) {
      console.error("Practice autopilot failed", { error: String(error) });
    }
  }
  return { portfolios: rows.length, trades };
}

// The pause switch: the whole portfolio, or opportunities alone (step 292). Takes effect before
// the next run.
export async function setPaused(
  userId: string,
  which: "all" | "opportunities",
  paused: boolean,
  { client = defaultClient }: Options = {},
) {
  const { portfolio } = await loadLedger(userId, client);
  await client.practicePortfolio.update({
    where: { id: portfolio.id },
    data: which === "all" ? { paused } : { opportunitiesPaused: paused },
  });
  await logAudit(
    { type: "user", id: userId },
    "practice_trade",
    { type: "practice_portfolio", id: portfolio.id },
    {
      side: paused ? "pause" : "resume",
      rule: which,
      simulated: "true",
    },
  );
}

export type LogRow = {
  id: string;
  placedAt: Date;
  side: string;
  ticker: string | null;
  amountCents: number;
  priceCents: number | null;
  gainCents: number | null;
  reason: string;
  rule: string;
  undone: boolean;
};

export async function tradeLog(
  userId: string,
  { client = defaultClient, limit = 50 }: { client?: PrismaClient; limit?: number } = {},
): Promise<LogRow[]> {
  return scopedFor(userId, client).practiceTrades.findMany({
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      placedAt: true,
      side: true,
      ticker: true,
      amountCents: true,
      priceCents: true,
      gainCents: true,
      reason: true,
      rule: true,
      undone: true,
    },
  });
}

// Undo the latest trade (practice only): it is marked undone and the ledger is rebuilt from
// every trade that stands. The starting money can't be undone.
export async function undoLastTrade(userId: string, { client = defaultClient }: Options = {}) {
  const { portfolio } = await loadLedger(userId, client);
  const last = await client.practiceTrade.findFirst({
    where: { portfolioId: portfolio.id, undone: false, rule: { not: "start" } },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
  });
  if (!last) throw new PracticeError("There's nothing to undo.");
  const standing = await client.practiceTrade.findMany({
    where: { portfolioId: portfolio.id, undone: false, id: { not: last.id } },
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
  });
  const entries: Entry[] = standing.map((t) =>
    t.side === "deposit"
      ? { side: "deposit", amountCents: t.amountCents }
      : {
          side: t.side as "buy" | "sell",
          ticker: t.ticker!,
          amountCents: t.amountCents,
          priceCents: t.priceCents!,
        },
  );
  const rebuilt = replay(0, entries, PRACTICE_UNIVERSE);
  await client.$transaction([
    client.practiceTrade.update({ where: { id: last.id }, data: { undone: true } }),
    client.practicePortfolio.update({
      where: { id: portfolio.id },
      data: { cashCents: rebuilt.cashCents },
    }),
    client.practicePosition.deleteMany({ where: { portfolioId: portfolio.id } }),
    client.practicePosition.createMany({
      data: Object.entries(rebuilt.positions).map(([ticker, p]) => ({
        portfolioId: portfolio.id,
        userId,
        ticker,
        quantity: p.quantity,
        costBasisCents: p.costBasisCents,
      })),
    }),
  ]);
  await logAudit(
    { type: "user", id: userId },
    "practice_trade",
    { type: "practice_trade", id: last.id },
    {
      side: "undo",
      rule: last.rule,
      simulated: "true",
    },
  );
  return { undone: last.id, side: last.side, ticker: last.ticker };
}
