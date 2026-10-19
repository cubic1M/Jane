import {
  DEBT_OFF_TRACK_MIN_CENTS,
  DEBT_OFF_TRACK_SHARE,
  DEBT_PLAN_CHECK_DAYS,
  MAX_DEBT_EXTRA_CENTS,
} from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import type { Strategy } from "@/planning/debt";
import {
  expectedBalances,
  monthAfter,
  payoffSummary,
  planDebts,
  type PayoffSummary,
} from "@/planning/payoff";

// The payoff plan (spec step 110): what the person started, and Jane keeping it current.
// The plan is always worked out from today's balances (so it updates itself); once a
// month Jane also checks what's owed against what the plan expected, and records whether
// it's on track and the new debt-free month. Starting or stopping a plan moves no money.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_MONTH_DAYS = 30.44;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export const isStrategy = (v: unknown): v is Strategy => v === "avalanche" || v === "snowball";

export type StoredPlan = {
  strategy: Strategy;
  extraCents: number;
  startedOn: string;
  checkedOn: string;
  debtFreeMonth: string | null;
  previousDebtFreeMonth: string | null;
  status: "on_track" | "off_track" | null;
  expectedCents: number | null;
  actualCents: number | null;
};

export type Payoff = {
  advice: boolean;
  book: DebtBook;
  // The plan as it stands today: the person's own order and extra when they started one,
  // otherwise the minimums with nothing extra.
  summary: PayoffSummary;
  // YYYY-MM for the plan above, in its order (or highest rate first); null if it never ends.
  debtFreeMonth: string | null;
  stored: StoredPlan | null;
};

const PLAN_SELECT = {
  strategy: true,
  extraCents: true,
  startedOn: true,
  checkedOn: true,
  debtFreeMonth: true,
  previousDebtFreeMonth: true,
  status: true,
  expectedCents: true,
  actualCents: true,
  expected: true,
} as const;

function toStored(row: {
  strategy: string;
  extraCents: number;
  startedOn: Date;
  checkedOn: Date;
  debtFreeMonth: string | null;
  previousDebtFreeMonth: string | null;
  status: string | null;
  expectedCents: number | null;
  actualCents: number | null;
}): StoredPlan {
  return {
    strategy: isStrategy(row.strategy) ? row.strategy : "avalanche",
    extraCents: row.extraCents,
    startedOn: isoDay(row.startedOn),
    checkedOn: isoDay(row.checkedOn),
    debtFreeMonth: row.debtFreeMonth,
    previousDebtFreeMonth: row.previousDebtFreeMonth,
    status: row.status === "on_track" || row.status === "off_track" ? row.status : null,
    expectedCents: row.expectedCents,
    actualCents: row.actualCents,
  };
}

// The debt-free month of a summary in a given order.
export function debtFreeOf(summary: PayoffSummary, strategy: Strategy, asOf: string) {
  const plan = summary[strategy];
  return plan.ok ? monthAfter(asOf, plan.months) : null;
}

export async function loadPayoff(
  userId: string,
  { client = defaultClient, now = new Date(), extraCents }: Options & { extraCents?: number } = {},
): Promise<Payoff> {
  const [book, advice, row] = await Promise.all([
    loadDebts(userId, { client, now }),
    adviceMode(userId, { client }),
    scopedFor(userId, client).debtPlans.findFirst({ select: PLAN_SELECT }),
  ]);
  const stored = row ? toStored(row) : null;
  const summary = payoffSummary(book.debts, {
    extraCents: extraCents ?? stored?.extraCents ?? 0,
    advice,
  });
  const strategy = stored?.strategy ?? summary.pick?.strategy ?? "avalanche";
  return {
    advice,
    book,
    summary,
    debtFreeMonth: debtFreeOf(summary, strategy, isoDay(now)),
    stored,
  };
}

export class DebtPlanError extends Error {}

// Starts (or changes) the plan: its order and extra a month, laid out from today.
export async function startDebtPlan(
  userId: string,
  input: { strategy: unknown; extraCents: number },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StoredPlan> {
  if (!isStrategy(input.strategy)) throw new DebtPlanError("Pick an order to pay them in.");
  const { extraCents } = input;
  if (!Number.isInteger(extraCents) || extraCents < 0 || extraCents > MAX_DEBT_EXTRA_CENTS) {
    throw new DebtPlanError("Enter the extra a month in dollars.");
  }
  const book = await loadDebts(userId, { client, now });
  const summary = payoffSummary(book.debts, { extraCents, advice: false });
  if (summary.cards.length === 0) throw new DebtPlanError("There are no debts to plan yet.");
  const plan = summary[input.strategy];
  const today = isoDay(now);
  const data = {
    strategy: input.strategy,
    extraCents,
    checkedOn: new Date(`${today}T00:00:00Z`),
    expected: expectedBalances(summary.cards, plan) as Prisma.InputJsonArray,
    debtFreeMonth: plan.ok ? monthAfter(today, plan.months) : null,
    previousDebtFreeMonth: null,
    status: null,
    expectedCents: null,
    actualCents: null,
  };
  const row = await scopedFor(userId, client).debtPlans.upsert({
    where: { userId },
    create: { userId, ...data, startedOn: data.checkedOn },
    update: { ...data, startedOn: data.checkedOn },
    select: PLAN_SELECT,
  });
  await track(userId, "debt_plan_started", { strategy: input.strategy, extra: extraCents > 0 });
  return toStored(row);
}

export async function stopDebtPlan(userId: string, { client = defaultClient }: Options = {}) {
  await scopedFor(userId, client).debtPlans.deleteMany({});
  await track(userId, "debt_plan_stopped");
}

export type PlanCheck = {
  status: "on_track" | "off_track";
  expectedCents: number;
  actualCents: number;
};

// Pure: what's owed against what the plan expected after `months` months. expected[0] is
// what was owed at the last check, expected[k] what should be owed k months later. Off
// track when less than DEBT_OFF_TRACK_SHARE of the planned paydown happened.
export function checkPlan(
  expected: readonly number[],
  months: number,
  actualCents: number,
): PlanCheck | null {
  if (expected.length < 2 || months < 1) return null;
  const expectedCents = expected[Math.min(months, expected.length - 1)];
  const plannedDown = expected[0] - expectedCents;
  const allowance = Math.max(
    DEBT_OFF_TRACK_MIN_CENTS,
    Math.round(plannedDown * DEBT_OFF_TRACK_SHARE),
  );
  return {
    status: actualCents > expectedCents + allowance ? "off_track" : "on_track",
    expectedCents,
    actualCents,
  };
}

// The monthly check (spec step 110), run before Jane's brain looks at the person's money:
// when a month has passed since the last check, compares what the plan's debts add up to
// with what the plan expected, then lays the plan out again from today's balances. Null
// when there's no plan or it isn't time yet.
export async function refreshDebtPlan(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<(PlanCheck & { debtFreeMonth: string | null }) | null> {
  const db = scopedFor(userId, client);
  const row = await db.debtPlans.findFirst({ select: PLAN_SELECT });
  if (!row) return null;
  const days = (now.getTime() - row.checkedOn.getTime()) / DAY_MS;
  if (days < DEBT_PLAN_CHECK_DAYS) return null;
  const stored = toStored(row);
  const book = await loadDebts(userId, { client, now });
  const { cards } = planDebts(book.debts);
  const actualCents = cards.reduce((sum, c) => sum + c.balanceCents, 0);
  const expected = Array.isArray(row.expected) ? (row.expected as number[]) : [];
  const check = checkPlan(
    expected,
    Math.max(1, Math.round(days / AVERAGE_MONTH_DAYS)),
    actualCents,
  );
  const summary = payoffSummary(book.debts, { extraCents: stored.extraCents, advice: false });
  const plan = summary[stored.strategy];
  const today = isoDay(now);
  const debtFreeMonth = plan.ok ? monthAfter(today, plan.months) : null;
  await db.debtPlans.updateMany({
    data: {
      checkedOn: new Date(`${today}T00:00:00Z`),
      expected: expectedBalances(summary.cards, plan) as Prisma.InputJsonArray,
      previousDebtFreeMonth: stored.debtFreeMonth,
      debtFreeMonth,
      status: check?.status ?? null,
      expectedCents: check?.expectedCents ?? null,
      actualCents: check?.actualCents ?? null,
    },
  });
  if (!check) return null;
  await track(userId, "debt_plan_checked", { status: check.status });
  return { ...check, debtFreeMonth };
}
