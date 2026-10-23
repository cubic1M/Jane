import { createHash, randomUUID } from "node:crypto";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import {
  CASH_MOVE_DAYS,
  CURRENT_CASH_RATE_BPS,
  MONEY_MARKET_TICKER,
  type CashPlaceKind,
} from "@/config/cash";
import { FUND_NAMES } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { fundProfile, fundTarget } from "@/lib/emergency-fund";
import { fundBasis } from "@/planning/emergency-fund";
import { averageMonthlySpending } from "@/insights/spending";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { scheduleTransfer, TransferError } from "@/lib/money-movement/transfers";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { cashPlan, type CashPlace, type CashPlan } from "@/planning/cash";
import { loadInvestments, type Investments } from "./holdings";

// Cash done right (spec step 162), for its page, Jane's answers, her buttons and tools.
// Cash in checking, savings and the brokerage's sweep, at stand-in rates; the plan from
// src/planning/cash.ts; and the two taps, through the money-movement and brokerage
// stand-ins. Moving money is always the person's tap.

type Options = { client?: PrismaClient; now?: Date };

export class CashError extends Error {}

const DAY_MS = 86_400_000;

export type CashView = {
  advice: boolean;
  places: CashPlace[];
  monthlySpendingCents: number;
  emergencyTargetCents: number;
  // From the person's own emergency fund goal, or months of their spending.
  emergencyFromGoal: boolean;
  emergencyBasis: string | null;
  plan: (CashPlan & { key: string }) | null;
};

export async function loadCash(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    investments: loaded,
  }: Options & { investments?: Investments } = {},
): Promise<CashView> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [advice, accounts, investments, transactions, goals, moved] = await Promise.all([
    adviceMode(userId, { client }),
    db.accounts.findMany({
      where: { type: "depository", subtype: { in: ["checking", "savings"] } },
      select: { id: true, name: true, subtype: true, currentBalanceCents: true },
      orderBy: { name: "asc" },
    }),
    loaded ?? loadInvestments(userId, { client, now }),
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    db.savingsGoals.findMany({ select: { name: true, targetCents: true } }),
    // Cash Jane moved lately: the demo bank's balances don't show stand-in transfers.
    db.moneyTransfers.findMany({
      where: {
        purpose: "cash",
        status: { not: "cancelled" },
        createdAt: { gte: new Date(now.getTime() - CASH_MOVE_DAYS * DAY_MS) },
      },
      select: { fromAccountId: true, toAccountId: true, amountCents: true },
    }),
  ]);
  const shift = new Map<string, number>();
  for (const m of moved) {
    shift.set(m.fromAccountId, (shift.get(m.fromAccountId) ?? 0) - m.amountCents);
    if (m.toAccountId) shift.set(m.toAccountId, (shift.get(m.toAccountId) ?? 0) + m.amountCents);
  }
  const places: CashPlace[] = accounts
    .filter((a) => a.currentBalanceCents !== null)
    .map((a) => {
      const kind = a.subtype === "savings" ? "savings" : "checking";
      return {
        id: a.id,
        name: a.name,
        kind: kind as CashPlaceKind,
        balanceCents: (a.currentBalanceCents ?? 0) + (shift.get(a.id) ?? 0),
        rateBps: CURRENT_CASH_RATE_BPS[kind],
      };
    });
  // The brokerage's uninvested cash (its sweep), taxable accounts only.
  for (const a of investments.accounts.filter((x) => x.subtype === "brokerage")) {
    const cash = a.holdings
      .filter((h) => h.isCash && h.ticker !== MONEY_MARKET_TICKER)
      .reduce((s, h) => s + h.valueCents, 0);
    if (cash > 0) {
      places.push({
        id: a.id,
        name: `${a.name} cash`,
        kind: "sweep",
        balanceCents: cash,
        rateBps: CURRENT_CASH_RATE_BPS.sweep,
      });
    }
  }
  const monthlySpendingCents = averageMonthlySpending(transactions, asOf, BUDGET_SUGGESTION_MONTHS);
  // Their own emergency fund goal, else the fund sized for them, as the drafted goal is.
  const goal = goals.find((g) => /emergency/i.test(g.name));
  const fund = goal
    ? null
    : fundTarget(monthlySpendingCents, await fundProfile(userId, { client, now }));
  const emergencyTargetCents = goal?.targetCents ?? fund?.targetCents ?? 0;
  const plan =
    places.length > 0 ? cashPlan({ places, monthlySpendingCents, emergencyTargetCents }) : null;
  return {
    advice,
    places,
    monthlySpendingCents,
    emergencyTargetCents,
    emergencyFromGoal: Boolean(goal),
    // How the fund was sized when there's no goal ("6 months of your own average spending").
    emergencyBasis: fund ? fundBasis(fund) : null,
    plan: plan && {
      ...plan,
      // The plan the person saw: the same moves.
      key: createHash("sha256")
        .update(JSON.stringify(plan.moves.map((m) => [m.key, m.fromId, m.cents])))
        .digest("hex")
        .slice(0, 24),
    },
  };
}

// One tap: one of the plan's moves, while the plan is the one the person saw.
export async function moveCash(
  userId: string,
  key: string,
  moveKey: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadCash(userId, { client, now });
  if (!view.advice) throw new CashError("Moving cash is only in demo advice mode for now.");
  if (!view.plan || view.plan.key !== key)
    throw new CashError("Your cash changed since this plan. Here's the new one.");
  const move = view.plan.moves.find((m) => m.key === moveKey);
  if (!move) throw new CashError("That move isn't in the plan any more.");
  if (move.key === "checking_to_savings") {
    try {
      const transfer = await scheduleTransfer(
        userId,
        {
          fromAccountId: move.fromId,
          toAccountId: move.toId,
          toName: move.toName,
          amountCents: move.cents,
          purpose: "cash",
          sector: "goals",
          planKey: `cash:${key}`,
        },
        "person",
        { client, now },
      );
      await track(userId, "cash_moved", { move: move.key });
      return { move, runOn: transfer.runOn };
    } catch (error) {
      if (error instanceof TransferError) throw new CashError(error.message);
      throw error;
    }
  }
  // Brokerage cash into the money market fund, through the brokerage partner.
  const partner = brokeragePartner();
  const batchId = randomUUID();
  const confirmations = await partner.placeOrders(
    userId,
    {
      batchId,
      reason: "cash",
      orders: [
        {
          accountId: move.fromId,
          ticker: MONEY_MARKET_TICKER,
          securityName: FUND_NAMES[MONEY_MARKET_TICKER] ?? MONEY_MARKET_TICKER,
          side: "buy",
          amountCents: move.cents,
        },
      ],
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: "cash", orders: confirmations.length, simulated: partner.simulated },
  );
  await track(userId, "cash_moved", { move: move.key });
  const account = await scopedFor(userId, client).accounts.findFirst({
    where: { id: move.fromId },
    select: { itemId: true },
  });
  if (account?.itemId) await syncDemoInvestments(account.itemId, { client, now });
  return { move, runOn: now.toISOString().slice(0, 10) };
}
