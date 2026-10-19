import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import {
  GOAL_TRANSFER_CATEGORIES,
  GOAL_TRANSFER_DAYS,
  GOAL_TRANSFER_MIN_CENTS,
  REVIEW_DAYS,
  TUNE_UP_DAYS,
  UPKEEP_AUTO_LEVELS,
} from "@/config/plan-upkeep";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { addDays } from "@/detection/units";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { track } from "@/lib/analytics";
import { autopilotOf } from "@/lib/autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { tuneUpChanges, type TuneUpChange } from "@/planning/tune-up";

// Plans that keep up (spec step 101): a budget tune-up in the first days of each month and
// transfers to savings counted toward a goal tracked by hand. At "Handle the safe stuff"
// and "Handle everything allowed" (UPKEEP_AUTO_LEVELS) Jane applies both by herself, with
// Undo on the tune-up; below that nothing changes without a tap (Accept all, Count it).

type Options = { client?: PrismaClient; now?: Date };

const isoDay = (now: Date) => now.toISOString().slice(0, 10);

export type TuneUpView = { month: string; changes: TuneUpChange[]; status: string };

const changesOf = (value: Prisma.JsonValue): TuneUpChange[] =>
  Array.isArray(value)
    ? value.flatMap((c) => {
        const row = c as Partial<TuneUpChange> | null;
        return row &&
          typeof row.category === "string" &&
          typeof row.fromCents === "number" &&
          typeof row.toCents === "number"
          ? [{ category: row.category, fromCents: row.fromCents, toCents: row.toCents }]
          : [];
      })
    : [];

// This month's tune-up, worked out once (in its first days) and kept, so Accept all applies
// exactly what was shown. Null when it isn't the time or nothing needs tuning.
export async function currentTuneUp(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TuneUpView | null> {
  const asOf = isoDay(now);
  const month = asOf.slice(0, 7);
  const db = scopedFor(userId, client);
  const saved = await db.budgetTuneUps.findFirst({ where: { month } });
  if (saved) return { month, changes: changesOf(saved.changes), status: saved.status };
  if (Number(asOf.slice(8, 10)) > TUNE_UP_DAYS) return null;
  const budgets = await db.budgets.findMany({ select: { category: true, amountCents: true } });
  if (budgets.length === 0) return null;
  const transactions = await loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1);
  const changes = tuneUpChanges(budgetSummary(transactions, budgets, asOf), budgets);
  if (changes.length === 0) return null;
  await db.budgetTuneUps.createMany({
    data: [{ userId, month, changes: changes as Prisma.InputJsonArray }],
    skipDuplicates: true,
  });
  return { month, changes, status: "proposed" };
}

export class UpkeepError extends Error {}

async function setAmounts(
  userId: string,
  amounts: { category: string; cents: number }[],
  client: PrismaClient,
) {
  const db = scopedFor(userId, client);
  for (const { category, cents } of amounts) {
    await db.budgets.updateMany({ where: { category }, data: { amountCents: cents } });
  }
}

async function decide(
  userId: string,
  month: string,
  from: string,
  to: string,
  { client = defaultClient, now = new Date() }: Options,
): Promise<TuneUpChange[]> {
  const db = scopedFor(userId, client);
  const row = await db.budgetTuneUps.findFirst({ where: { month } });
  if (!row) throw new UpkeepError("That tune-up isn't there anymore.");
  const { count } = await db.budgetTuneUps.updateMany({
    where: { month, status: from },
    data: { status: to, decidedAt: now },
  });
  if (count === 0) throw new UpkeepError("That tune-up was already answered.");
  return changesOf(row.changes);
}

// Accept all (a tap) or autopilot: every budget to its tuned amount.
export async function applyTuneUp(
  userId: string,
  month: string,
  by: "accepted" | "auto",
  options: Options = {},
): Promise<TuneUpChange[]> {
  const changes = await decide(userId, month, "proposed", by, options);
  await setAmounts(
    userId,
    changes.map((c) => ({ category: c.category, cents: c.toCents })),
    options.client ?? defaultClient,
  );
  await track(userId, "budget_tune_up", { result: by, budgets: changes.length });
  return changes;
}

export async function keepTuneUp(userId: string, month: string, options: Options = {}) {
  await decide(userId, month, "proposed", "kept", options);
  await track(userId, "budget_tune_up", { result: "kept" });
}

// Undo after autopilot applied it: the budgets go back to what they were.
export async function undoTuneUp(userId: string, month: string, options: Options = {}) {
  const changes = await decide(userId, month, "auto", "undone", options);
  await setAmounts(
    userId,
    changes.map((c) => ({ category: c.category, cents: c.fromCents })),
    options.client ?? defaultClient,
  );
  await track(userId, "budget_tune_up", { result: "undone" });
}

export type GoalTransferView = {
  transactionId: string;
  amountCents: number;
  date: string;
  goal: { id: string; name: string };
};

// The goal transfers count toward: the soonest goal tracked by hand that's on the way.
async function goalForTransfers(userId: string, client: PrismaClient, now: Date) {
  const goals = await listGoals(userId, { client, now });
  return goals.find((g) => g.accountId === null && g.progress.status === "on_the_way") ?? null;
}

// Transfers to savings since the goal was set, not yet counted or skipped.
export async function pendingGoalTransfers(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<GoalTransferView[]> {
  const goal = await goalForTransfers(userId, client, now);
  if (!goal) return [];
  const db = scopedFor(userId, client);
  const created = await db.savingsGoals.findFirst({
    where: { id: goal.id },
    select: { createdAt: true },
  });
  const since = addDays(isoDay(now), -GOAL_TRANSFER_DAYS);
  const from = created && isoDay(created.createdAt) > since ? isoDay(created.createdAt) : since;
  const [transfers, seen] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        pfcDetailed: { in: [...GOAL_TRANSFER_CATEGORIES] },
        amountCents: { gte: GOAL_TRANSFER_MIN_CENTS },
        date: { gte: new Date(`${from}T00:00:00Z`), lte: now },
      },
      select: { id: true, amountCents: true, date: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    db.goalTransfers.findMany({ select: { transactionId: true } }),
  ]);
  const done = new Set(seen.map((s) => s.transactionId));
  return transfers
    .filter((t) => !done.has(t.id))
    .map((t) => ({
      transactionId: t.id,
      amountCents: t.amountCents,
      date: isoDay(t.date),
      goal: { id: goal.id, name: goal.name },
    }));
}

export type CountedTransfer = {
  amountCents: number;
  goalName: string;
  savedCents: number;
  targetCents: number;
};

// Count it (a tap) or autopilot: the transfer goes toward the goal, once.
export async function countGoalTransfer(
  userId: string,
  transactionId: string,
  by: "counted" | "auto",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CountedTransfer> {
  const pending = await pendingGoalTransfers(userId, { client, now });
  const transfer = pending.find((t) => t.transactionId === transactionId);
  if (!transfer) throw new UpkeepError("That transfer was already counted or skipped.");
  const db = scopedFor(userId, client);
  const { count } = await db.goalTransfers.createMany({
    data: [
      {
        userId,
        transactionId,
        goalId: transfer.goal.id,
        amountCents: transfer.amountCents,
        status: by,
        createdAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) throw new UpkeepError("That transfer was already counted or skipped.");
  const goal = await db.savingsGoals.findFirstOrThrow({
    where: { id: transfer.goal.id },
    select: { manualSavedCents: true, targetCents: true },
  });
  const savedCents = (goal.manualSavedCents ?? 0) + transfer.amountCents;
  await db.savingsGoals.updateMany({
    where: { id: transfer.goal.id },
    data: { manualSavedCents: savedCents },
  });
  await track(userId, "goal_transfer_counted", { by });
  return {
    amountCents: transfer.amountCents,
    goalName: transfer.goal.name,
    savedCents,
    targetCents: goal.targetCents,
  };
}

export async function skipGoalTransfer(
  userId: string,
  transactionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const pending = await pendingGoalTransfers(userId, { client, now });
  const transfer = pending.find((t) => t.transactionId === transactionId);
  if (!transfer) throw new UpkeepError("That transfer was already counted or skipped.");
  await scopedFor(userId, client).goalTransfers.createMany({
    data: [{ userId, transactionId, amountCents: transfer.amountCents, status: "skipped" }],
    skipDuplicates: true,
  });
}

// What autopilot did lately: transfers it counted, for Jane to say so.
export async function recentAutoTransfers(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.goalTransfers.findMany({
    where: { status: "auto", createdAt: { gte: since } },
    select: { transactionId: true, goalId: true, amountCents: true },
    orderBy: { createdAt: "asc" },
  });
  const goals = await listGoals(userId, { client, now });
  return rows.flatMap((r) => {
    const goal = goals.find((g) => g.id === r.goalId);
    return goal
      ? [
          {
            transactionId: r.transactionId,
            amountCents: r.amountCents,
            goalName: goal.name,
            savedCents: goal.progress.savedCents,
            targetCents: goal.targetCents,
          },
        ]
      : [];
  });
}

export type UpkeepSnapshot = {
  tuneUp: TuneUpView | null;
  transfers: GoalTransferView[];
  counted: Awaited<ReturnType<typeof recentAutoTransfers>>;
};

// For Jane's brain (src/lib/jane-agent/snapshot.ts).
export async function loadUpkeep(userId: string, options: Options = {}): Promise<UpkeepSnapshot> {
  const [tuneUp, transfers, counted] = await Promise.all([
    currentTuneUp(userId, options),
    pendingGoalTransfers(userId, options),
    recentAutoTransfers(userId, options),
  ]);
  return { tuneUp, transfers, counted };
}

// What Jane does by herself at the levels that allow it: applies this month's tune-up and
// counts new transfers toward the goal. Run before her brain looks at the person's money.
export async function runPlanUpkeep(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ tuned: number; counted: number }> {
  const level = await autopilotOf(userId, { client });
  if (!UPKEEP_AUTO_LEVELS.some((l) => l === level)) return { tuned: 0, counted: 0 };
  let tuned = 0;
  const tuneUp = await currentTuneUp(userId, { client, now });
  if (tuneUp?.status === "proposed") {
    tuned = (await applyTuneUp(userId, tuneUp.month, "auto", { client, now })).length;
  }
  let counted = 0;
  for (const t of await pendingGoalTransfers(userId, { client, now })) {
    await countGoalTransfer(userId, t.transactionId, "auto", { client, now });
    counted += 1;
  }
  return { tuned, counted };
}
