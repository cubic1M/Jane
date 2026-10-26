import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { parseMoneyToCents } from "@/lib/money";
import { GOAL_ORDER_FACT } from "@/config/tradeoffs";
import { orderGoals, parseGoalOrder } from "@/planning/goal-tradeoffs";
import { goalProgress, type GoalProgress } from "@/planning/goals";
import { cachedCopy } from "@/lib/read-cache";

// Savings goals: adding, updating and listing them with their progress.

type Options = { client?: PrismaClient; now?: Date };

export class GoalError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 80;
// $20 million: fits a database integer (cents), and catches typos.
const MAX_GOAL_CENTS = 2_000_000_000;

export type GoalForm = {
  name: string;
  target: string;
  targetDate: string;
  accountId: string;
  saved: string;
};

async function checkedData(userId: string, form: GoalForm, client: PrismaClient) {
  const name = form.name.trim().slice(0, MAX_NAME);
  if (!name) throw new GoalError("Give the goal a name.");
  const targetCents = parseMoneyToCents(form.target);
  if (targetCents === null || targetCents <= 0 || targetCents > MAX_GOAL_CENTS) {
    throw new GoalError("Enter the amount you're saving for, like 5000.");
  }
  if (!DATE.test(form.targetDate) || Number.isNaN(Date.parse(form.targetDate))) {
    throw new GoalError("Pick a date.");
  }
  let accountId: string | null = null;
  if (form.accountId) {
    const account = await scopedFor(userId, client).accounts.findFirst({
      where: { id: form.accountId },
      select: { id: true },
    });
    if (!account) throw new GoalError("Pick one of your accounts.");
    accountId = account.id;
  }
  let manualSavedCents: number | null = null;
  if (!accountId && form.saved.trim()) {
    manualSavedCents = parseMoneyToCents(form.saved);
    if (manualSavedCents === null || manualSavedCents < 0) {
      throw new GoalError("Enter what you've saved so far, like 1200.");
    }
  }
  return {
    name,
    targetCents,
    targetDate: new Date(`${form.targetDate}T00:00:00Z`),
    accountId,
    manualSavedCents,
  };
}

export async function addGoal(
  userId: string,
  form: GoalForm,
  { client = defaultClient }: Options = {},
) {
  const data = await checkedData(userId, form, client);
  await scopedFor(userId, client).savingsGoals.create({ data: { userId, ...data } });
}

export async function updateGoal(
  userId: string,
  goalId: string,
  form: GoalForm,
  { client = defaultClient }: Options = {},
) {
  const data = await checkedData(userId, form, client);
  const { count } = await scopedFor(userId, client).savingsGoals.updateMany({
    where: { id: goalId },
    data,
  });
  if (count === 0) throw new GoalError("That goal doesn't exist.");
}

export async function deleteGoal(
  userId: string,
  goalId: string,
  { client = defaultClient }: Options = {},
) {
  await scopedFor(userId, client).savingsGoals.deleteMany({ where: { id: goalId } });
}

export type GoalView = {
  id: string;
  name: string;
  targetCents: number;
  targetDate: string;
  accountId: string | null;
  // The linked account's name, or null when tracked by hand (or the account is gone).
  accountName: string | null;
  manualSavedCents: number | null;
  progress: GoalProgress;
};

export async function listGoals(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<GoalView[]> {
  // Read once per sync (src/lib/read-cache.ts).
  return cachedCopy(`goals:${userId}:${now.toISOString()}`, client, () =>
    listGoalsFrom(userId, { client, now }),
  );
}

async function listGoalsFrom(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<GoalView[]> {
  const db = scopedFor(userId, client);
  const [goals, accounts, order] = await Promise.all([
    db.savingsGoals.findMany({ orderBy: [{ targetDate: "asc" }, { id: "asc" }] }),
    db.accounts.findMany({ select: { id: true, name: true, currentBalanceCents: true } }),
    // Spec step 241: the order the person picked when goals competed; by date otherwise.
    db.janePreferences.findFirst({
      where: { kind: "fact", key: GOAL_ORDER_FACT },
      select: { value: true },
    }),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const asOf = now.toISOString().slice(0, 10);
  const ordered = orderGoals(
    goals,
    parseGoalOrder((order?.value as { order?: unknown } | null)?.order),
  );
  return ordered.map((g) => {
    const account = g.accountId ? byId.get(g.accountId) : undefined;
    const saved =
      account?.currentBalanceCents !== undefined && account?.currentBalanceCents !== null
        ? account.currentBalanceCents
        : (g.manualSavedCents ?? 0);
    const targetDate = g.targetDate.toISOString().slice(0, 10);
    return {
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      targetDate,
      accountId: g.accountId,
      accountName: account?.name ?? null,
      manualSavedCents: g.manualSavedCents,
      progress: goalProgress({ targetCents: g.targetCents, savedCents: saved, targetDate }, asOf),
    };
  });
}
