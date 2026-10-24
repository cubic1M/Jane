import { PRACTICE_START_CENTS } from "@/config/portfolios";
import type { RiskLevel } from "@/config/investing";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData } from "@/lib/market";
import { value, type LedgerState } from "@/planning/practice-ledger";
import { loadLedger, NoPracticePortfolio } from "./broker";
import { loadPreferences } from "./preferences";

// The practice portfolio (spec step 290, Phase AW, Stage A): start one, read it, put practice
// money in. Practice money only: it is not linked to any account.

type Options = { client?: PrismaClient; now?: Date };

export class PracticeError extends Error {}

export async function startPractice(
  userId: string,
  level: RiskLevel,
  {
    client = defaultClient,
    now = new Date(),
    auto = false,
  }: Options & {
    // Started by Jane for a sample person (./demo-start.ts), not by the person.
    auto?: boolean;
  } = {},
  startingCents = PRACTICE_START_CENTS,
) {
  const db = scopedFor(userId, client);
  if (await db.practicePortfolios.findFirst({ select: { id: true } })) {
    throw new PracticeError("You already have a practice portfolio.");
  }
  if (!Number.isInteger(startingCents) || startingCents <= 0)
    throw new PracticeError("Pick a starting amount.");
  // The monthly practice money and its day are the person's (their preferences).
  const prefs = await loadPreferences(userId, { client });
  const row = await client.practicePortfolio.create({
    data: {
      userId,
      level,
      startingCents,
      cashCents: startingCents,
      monthlyAddCents: prefs.monthlyAddCents,
      addDay: prefs.addDay,
      startedAt: now,
      trades: {
        create: {
          userId,
          placedAt: now,
          side: "deposit",
          amountCents: startingCents,
          reason: "Starting practice money.",
          rule: "start",
        },
      },
    },
    select: { id: true },
  });
  await logAudit(
    auto ? SYSTEM_ACTOR : { type: "user", id: userId },
    "practice_started",
    { type: "practice_portfolio", id: row.id },
    {
      level,
      simulated: "true",
      ...(auto ? { auto: "true" } : {}),
    },
  );
  await track(userId, "practice_started", { level, auto });
  return row.id;
}

export type PracticeView = {
  level: RiskLevel;
  paused: boolean;
  opportunitiesPaused: boolean;
  startedAt: Date;
  startingCents: number;
  state: LedgerState;
  totalCents: number;
  holdings: { ticker: string; quantity: number; valueCents: number; costBasisCents: number }[];
  monthlyAddCents: number;
};

export async function loadPractice(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PracticeView | null> {
  let ledger;
  try {
    ledger = await loadLedger(userId, client);
  } catch (error) {
    if (error instanceof NoPracticePortfolio) return null;
    throw error;
  }
  const { portfolio, state } = ledger;
  const asOf = now.toISOString().slice(0, 10);
  const feed = marketData();
  const prices: Record<string, number> = {};
  for (const ticker of Object.keys(state.positions)) {
    prices[ticker] = (await feed.latest(ticker, asOf))?.closeCents ?? 0;
  }
  return {
    level: portfolio.level as RiskLevel,
    paused: portfolio.paused,
    opportunitiesPaused: portfolio.opportunitiesPaused,
    startedAt: portfolio.startedAt,
    startingCents: portfolio.startingCents,
    state,
    totalCents: value(state, prices),
    holdings: Object.entries(state.positions).map(([ticker, p]) => ({
      ticker,
      quantity: p.quantity,
      costBasisCents: p.costBasisCents,
      valueCents: Math.round(p.quantity * (prices[ticker] ?? 0)),
    })),
    monthlyAddCents: portfolio.monthlyAddCents,
  };
}

// Practice money in (the monthly add, step 291). A deposit changes cash and the log only.
export async function addPracticeMoney(
  userId: string,
  amountCents: number,
  reason: string,
  rule: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw new PracticeError("Pick an amount.");
  const { portfolio } = await loadLedger(userId, client);
  await client.$transaction([
    client.practiceTrade.create({
      data: {
        portfolioId: portfolio.id,
        userId,
        placedAt: now,
        side: "deposit",
        amountCents,
        reason,
        rule,
      },
    }),
    client.practicePortfolio.update({
      where: { id: portfolio.id },
      data: { cashCents: { increment: amountCents } },
    }),
  ]);
  await logAudit(
    { type: "user", id: userId },
    "practice_trade",
    { type: "practice_portfolio", id: portfolio.id },
    {
      side: "deposit",
      rule,
      simulated: "true",
    },
  );
}
