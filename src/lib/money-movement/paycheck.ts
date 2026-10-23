import {
  DEFAULT_PAYCHECKS_PER_MONTH,
  PAYCHECK_BUFFER_MARGIN_CENTS,
  PAYCHECK_CUSHION_CENTS,
  PAYCHECK_FORECAST_DAYS,
  PAYCHECK_PLAN_DAYS,
} from "@/config/money-movement";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { addDays, daysBetween, median } from "@/detection/units";
import { PAYCHECKS_PER_MONTH } from "@/config/detection";
import { paySchedules } from "@/detection/paydays";
import { employers } from "@/insights/changes";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadPayoff } from "@/lib/debt-plan";
import { leanActive } from "@/lib/lean-plan";
import { forecastAccounts } from "@/detection/forecast";
import { listGoals } from "@/lib/goals";
import { homeSummary } from "@/lib/home";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { payoffOrder } from "@/planning/debt";
import { paycheckPlan, type PlannedMove } from "@/planning/paycheck-plan";
import { moneyPartnerFor, type MoneyMovementPartner } from "./partner";
import { cancelTransfer, scheduleTransfer, TransferError } from "./transfers";

// Money that moves itself (spec step 144). When a paycheck lands, Jane works out its plan
// (src/planning/paycheck-plan.ts) and, through the money-movement partner, moves each part
// by herself where its sector's autopilot allows it and the amount fits the caps (step 141);
// the rest waits for one tap. Every transfer is on /transfers and can be undone while
// pending. Only with a partner: the stand-in for demo-bank people, nobody else yet.

type Options = { client?: PrismaClient; now?: Date; partner?: MoneyMovementPartner | null };

export type PlanMove = PlannedMove & {
  status: "moved" | "auto" | "asked" | "skipped";
  transferId?: string;
};

export type PaycheckPlanView = {
  id: string;
  key: string;
  paycheckCents: number;
  paidOn: string;
  status: string;
  moves: PlanMove[];
  // Spec step 206: what stayed for bills, the buffer, and went to investing.
  kept: { billsCents: number; bufferCents: number; investingCents: number } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const movesOf = (value: Prisma.JsonValue): PlanMove[] =>
  Array.isArray(value) ? (value as unknown as PlanMove[]) : [];

// The newest paycheck in the last few days, and how many come in a month.
export function latestPaycheck(input: DetectionInput) {
  const from = addDays(input.asOf, -PAYCHECK_PLAN_DAYS);
  let latest: { id: string; date: string; cents: number; perMonth: number } | null = null;
  const schedules = paySchedules(input);
  for (const employer of employers(input)) {
    const last = employer.deposits.at(-1)!;
    if (last.date <= from || last.date > input.asOf) continue;
    if (latest && last.date <= latest.date) continue;
    // From the employer's pay schedule (spec step 182): a weekly paycheck comes 4.33 times a
    // month, not 4. Without a schedule yet, from the usual gap.
    const schedule = schedules.find((x) => x.key === `employer:${employer.key}`);
    const gaps = employer.deposits
      .slice(1)
      .map((d, i) => daysBetween(employer.deposits[i].date, d.date));
    const perMonth = schedule
      ? PAYCHECKS_PER_MONTH[schedule.frequency]
      : gaps.length > 0
        ? Math.max(1, Math.round(30 / median(gaps)))
        : DEFAULT_PAYCHECKS_PER_MONTH;
    latest = { id: last.id, date: last.date, cents: -last.amountCents, perMonth };
  }
  return latest;
}

async function payoffDebt(userId: string, client: PrismaClient, now: Date) {
  const payoff = await loadPayoff(userId, { client, now });
  const stored = payoff.stored;
  if (!stored || stored.extraCents <= 0) return null;
  const [first] = payoffOrder(payoff.summary.cards, stored.strategy);
  if (!first?.id.startsWith("account:")) return null;
  return {
    accountId: first.id.slice("account:".length),
    name: first.name,
    extraCents: stored.extraCents,
  };
}

// After a paycheck: the plan, once, and what autopilot may move of it. Returns the plan.
export async function runPaycheckPlan(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    partner,
    input,
  }: Options & { input?: DetectionInput } = {},
): Promise<PaycheckPlanView | null> {
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  if (!movement) return null;
  // Spec step 204: while the lean plan is in force, nothing moves by itself.
  if (await leanActive(userId, { client })) return null;
  const loaded = input ?? (await loadDetectionInput(userId, { client, now }));
  const paycheck = latestPaycheck(loaded);
  if (!paycheck) return null;
  const key = `paycheck:${paycheck.id}`;
  const db = scopedFor(userId, client);
  const existing = await db.paycheckPlans.findFirst({ where: { key } });
  if (existing) return viewOf(existing);

  const checking = loaded.accounts.find((a) => a.type === "depository" && a.subtype === "checking");
  const home = await homeSummary(userId, { client, now });
  const safe = home?.safeToSpend;
  if (!checking || !safe) return null;
  const savings = loaded.accounts.find((a) => a.type === "depository" && a.subtype === "savings");
  const [goals, debt] = await Promise.all([
    listGoals(userId, { client, now }),
    payoffDebt(userId, client, now),
  ]);
  // Spec step 206: what can leave checking and still keep its forecast low above the margin
  // (transfers already pending count as gone).
  const lowest = forecastAccounts(loaded, PAYCHECK_FORECAST_DAYS).find(
    (f) => f.accountId === checking.id,
  )?.lowest.balanceCents;
  const pendingOut = (
    await db.moneyTransfers.findMany({
      where: { status: "pending", fromAccountId: checking.id },
      select: { amountCents: true },
    })
  ).reduce((s, t) => s + t.amountCents, 0);
  const invested =
    (
      await db.autoInvestRuns.findFirst({
        where: { status: "invested", paydayOn: new Date(`${paycheck.date}T00:00:00Z`) },
        select: { amountCents: true },
      })
    )?.amountCents ?? 0;
  const plan = paycheckPlan({
    forecastRoomCents:
      lowest === undefined ? null : Math.max(0, lowest - pendingOut - PAYCHECK_BUFFER_MARGIN_CENTS),
    investedCents: invested,
    paycheckCents: paycheck.cents,
    paychecksPerMonth: paycheck.perMonth,
    checkingAccountId: checking.id,
    savingsAccount: savings ? { id: savings.id, name: savings.name } : null,
    accountNames: Object.fromEntries(loaded.accounts.map((a) => [a.id, a.name])),
    balanceCents: safe.balanceCents,
    billsCents: safe.billsCents,
    budgetsLeftCents: safe.budgetsLeftCents,
    safeCents: safe.safeCents,
    cushionCents: PAYCHECK_CUSHION_CENTS,
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      monthlyCents: g.progress.status === "on_the_way" ? g.progress.monthlyCents : 0,
      accountId: g.accountId,
      onTheWay: g.progress.status === "on_the_way",
    })),
    debt,
  });
  // Autopilot first: each move its sector allows, within the caps, now.
  const moves: PlanMove[] = [];
  for (const move of plan.moves) {
    const allowed = await mayAct(
      userId,
      move.sector,
      { needs: move.needs, cents: move.cents },
      { client, now },
    );
    if (!allowed.ok) {
      moves.push({ ...move, status: "asked" });
      continue;
    }
    const { id } = await scheduleTransfer(
      userId,
      { ...move, amountCents: move.cents, planKey: key },
      "autopilot",
      {
        client,
        now,
        partner: movement,
      },
    );
    await recordAct(userId, move.sector, move.cents, `Moved ${move.label} from a paycheck`, {
      client,
      now,
    });
    moves.push({ ...move, status: "auto", transferId: id });
  }
  const asked = moves.filter((m) => m.status === "asked").length;
  const status =
    moves.length === 0
      ? "skipped"
      : asked === 0
        ? "auto"
        : asked === moves.length
          ? "proposed"
          : "partial";
  const row = await db.paycheckPlans.create({
    data: {
      userId,
      key,
      paycheckCents: paycheck.cents,
      paidOn: new Date(`${paycheck.date}T00:00:00Z`),
      moves: moves as unknown as Prisma.InputJsonArray,
      summary: {
        billsCents: plan.wentTo.billsCents,
        bufferCents: plan.wentTo.bufferCents,
        investingCents: plan.wentTo.investingCents,
      },
      status,
      createdAt: now,
    },
  });
  return viewOf(row);
}

function viewOf(row: {
  id: string;
  key: string;
  paycheckCents: number;
  paidOn: Date;
  status: string;
  moves: Prisma.JsonValue;
  summary?: Prisma.JsonValue;
}): PaycheckPlanView {
  return {
    id: row.id,
    key: row.key,
    paycheckCents: row.paycheckCents,
    paidOn: iso(row.paidOn),
    status: row.status,
    moves: movesOf(row.moves),
    kept:
      row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
        ? (row.summary as unknown as PaycheckPlanView["kept"])
        : null,
  };
}

export class PaycheckError extends Error {}

// "Move them": the person's one tap for what autopilot didn't move.
export async function movePaycheckPlan(
  userId: string,
  planId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<PlanMove[]> {
  const db = scopedFor(userId, client);
  const row = await db.paycheckPlans.findFirst({ where: { id: planId } });
  if (!row || (row.status !== "proposed" && row.status !== "partial")) {
    throw new PaycheckError("That paycheck's plan was already answered.");
  }
  const moves = movesOf(row.moves);
  const done: PlanMove[] = [];
  for (const move of moves) {
    if (move.status !== "asked") {
      done.push(move);
      continue;
    }
    try {
      const { id } = await scheduleTransfer(
        userId,
        { ...move, amountCents: move.cents, planKey: row.key },
        "person",
        {
          client,
          now,
          partner,
        },
      );
      done.push({ ...move, status: "moved", transferId: id });
    } catch (error) {
      if (!(error instanceof TransferError)) throw error;
      done.push({ ...move, status: "skipped" });
    }
  }
  await db.paycheckPlans.updateMany({
    where: { id: planId },
    data: { moves: done as unknown as Prisma.InputJsonArray, status: "moved" },
  });
  return done;
}

// "Not this time": nothing more moves for this paycheck.
export async function skipPaycheckPlan(
  userId: string,
  planId: string,
  { client = defaultClient }: Options = {},
) {
  const { count } = await scopedFor(userId, client).paycheckPlans.updateMany({
    where: { id: planId, status: { in: ["proposed", "partial"] } },
    data: { status: "skipped" },
  });
  if (count === 0) throw new PaycheckError("That paycheck's plan was already answered.");
}

// "Undo": every transfer from this paycheck that's still pending.
export async function undoPaycheckPlan(
  userId: string,
  planId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const row = await db.paycheckPlans.findFirst({ where: { id: planId }, select: { key: true } });
  if (!row) throw new PaycheckError("That paycheck's plan isn't there anymore.");
  const pending = await db.moneyTransfers.findMany({
    where: { planKey: row.key, status: "pending" },
    select: { id: true },
  });
  let undone = 0;
  for (const t of pending) {
    try {
      await cancelTransfer(userId, t.id, { client, now, partner });
      undone += 1;
    } catch (error) {
      if (!(error instanceof TransferError)) throw error;
    }
  }
  if (undone === 0) throw new PaycheckError("Those transfers have already gone through.");
  return undone;
}

// The newest plan, for the chat and Claude.
export async function latestPaycheckPlan(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PaycheckPlanView | null> {
  const row = await scopedFor(userId, client).paycheckPlans.findFirst({
    where: { paidOn: { gte: new Date(`${addDays(iso(now), -PAYCHECK_PLAN_DAYS * 3)}T00:00:00Z`) } },
    orderBy: { paidOn: "desc" },
  });
  return row ? viewOf(row) : null;
}
