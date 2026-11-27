import {
  DEBT_OFF_TRACK_MIN_CENTS,
  DEBT_OFF_TRACK_SHARE,
  DEBT_PLAN_CHECK_DAYS,
  MAX_DEBT_EXTRA_CENTS,
} from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { trackQuietly } from "@/lib/track-quietly";
import { db as defaultClient } from "@/lib/db";
import { todayOf } from "@/lib/today";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr, loadDebts } from "@/lib/debts";
import type { Strategy } from "@/planning/debt";
import {
  expectedBalances,
  monthAfter,
  payoffSummary,
  planDebts,
  type PayoffSummary,
} from "@/planning/payoff";
import { DAY_MS, isoDay } from "@/lib/dates";

// The payoff plan (spec step 110): what the person started, and Jane keeping it current.
// The plan is always worked out from today's balances (so it updates itself); once a
// month Jane also checks what's owed against what the plan expected, and records whether
// it's on track and the new debt-free month. Starting or stopping a plan moves no money.

type Options = { client?: PrismaClient; now?: Date };

const AVERAGE_MONTH_DAYS = 30.44;

const isStrategy = (v: unknown): v is Strategy => v === "avalanche" || v === "snowball";

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
  // The debts the plan covers (their ids); absent on a plan made before this was recorded.
  debtIds?: string[] | null;
  // The debts the last check left out of what it measured (they came after the plan was made).
  checkExcludedIds?: string[] | null;
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
  debtIds: true,
  checkExcludedIds: true,
  expected: true,
} as const;

const idsOf = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((id) => typeof id === "string") ? (value as string[]) : null;

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
  debtIds?: unknown;
  checkExcludedIds?: unknown;
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
    debtIds: idsOf(row.debtIds),
    checkExcludedIds: idsOf(row.checkExcludedIds),
  };
}

// The debt-free month of a summary in a given order.
function debtFreeOf(summary: PayoffSummary, strategy: Strategy, asOf: string) {
  const plan = summary[strategy];
  return plan.ok ? monthAfter(asOf, plan.months) : null;
}

export async function loadPayoff(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    extraCents,
    book: given,
  }: Options & { extraCents?: number; book?: DebtBook } = {},
): Promise<Payoff> {
  const [book, advice, row] = await Promise.all([
    debtsOr(given, userId, { client, now }),
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
    debtFreeMonth: debtFreeOf(summary, strategy, await todayOf(userId, { client, now })),
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
  const today = await todayOf(userId, { client, now });
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
    debtIds: summary.cards.map((c) => c.id),
  };
  // Starting a plan, by the person or by autopilot, lifts an earlier "stop the plan".
  await scopedFor(userId, client).janePreferences.deleteMany({
    where: { kind: "never", key: STOPPED_KEY },
  });
  const row = await scopedFor(userId, client).debtPlans.upsert({
    where: { userId },
    create: { userId, ...data, startedOn: data.checkedOn },
    update: { ...data, startedOn: data.checkedOn },
    select: PLAN_SELECT,
  });
  // The plan is saved and active: a failed analytics write doesn't fail its start.
  await trackQuietly(userId, "debt_plan_started", {
    strategy: input.strategy,
    extra: extraCents > 0,
  });
  return toStored(row);
}

// "Stop the plan" is the person's word: kept as a "never" preference (the same store as "Not
// this month" for the steady paycheck, so no new column) that debt autopilot reads, and that
// starting a plan again clears. It also shows in Settings, where the person can delete it.
const STOPPED_KEY = "debt_plan_stopped";

export async function debtPlanStopped(userId: string, client: PrismaClient): Promise<boolean> {
  return (
    (await scopedFor(userId, client).janePreferences.count({
      where: { kind: "never", key: STOPPED_KEY },
    })) > 0
  );
}

export async function stopDebtPlan(userId: string, { client = defaultClient }: Options = {}) {
  const db = scopedFor(userId, client);
  const data = {
    value: { stopped: true },
    label: "Jane doesn't start a debt payoff plan on its own again",
  };
  await db.janePreferences.upsert({
    where: { userId_kind_key: { userId, kind: "never", key: STOPPED_KEY } },
    create: { userId, kind: "never", key: STOPPED_KEY, ...data },
    update: data,
  });
  await db.debtPlans.deleteMany({});
  await trackQuietly(userId, "debt_plan_stopped");
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
  const row = await db.debtPlans.findFirst({ select: { ...PLAN_SELECT, updatedAt: true } });
  if (!row) return null;
  const days = (now.getTime() - row.checkedOn.getTime()) / DAY_MS;
  if (days < DEBT_PLAN_CHECK_DAYS) return null;
  const stored = toStored(row);
  const book = await loadDebts(userId, { client, now });
  const { cards } = planDebts(book.debts);
  // What the plan's own debts add up to: a debt added since the plan was made was never in what
  // the plan expected, so it is not counted against it (a plan with no record counts them all).
  const covered = stored.debtIds ? new Set(stored.debtIds) : null;
  const actualCents = cards
    .filter((c) => !covered || covered.has(c.id))
    .reduce((sum, c) => sum + c.balanceCents, 0);
  const expected = Array.isArray(row.expected) ? (row.expected as number[]) : [];
  const check = checkPlan(
    expected,
    Math.max(1, Math.round(days / AVERAGE_MONTH_DAYS)),
    actualCents,
  );
  const summary = payoffSummary(book.debts, { extraCents: stored.extraCents, advice: false });
  const plan = summary[stored.strategy];
  const today = await todayOf(userId, { client, now });
  const debtFreeMonth = plan.ok ? monthAfter(today, plan.months) : null;
  // Only the plan as it was read: one restarted or stopped while balances loaded isn't written
  // over with the old strategy's schedule, and no check is reported for a plan that isn't there.
  const written = await db.debtPlans.updateMany({
    where: { updatedAt: row.updatedAt },
    data: {
      checkedOn: new Date(`${today}T00:00:00Z`),
      expected: expectedBalances(summary.cards, plan) as Prisma.InputJsonArray,
      previousDebtFreeMonth: stored.debtFreeMonth,
      debtFreeMonth,
      status: check?.status ?? null,
      expectedCents: check?.expectedCents ?? null,
      actualCents: check?.actualCents ?? null,
      // The debts the plan is laid out over from now on, which the next check measures.
      debtIds: summary.cards.map((c) => c.id),
      // What this check left out, named in its message.
      checkExcludedIds: covered ? cards.filter((c) => !covered.has(c.id)).map((c) => c.id) : [],
    },
  });
  if (written.count === 0 || !check) return null;
  await trackQuietly(userId, "debt_plan_checked", { status: check.status });
  return { ...check, debtFreeMonth };
}
