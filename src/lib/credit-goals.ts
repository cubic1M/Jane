import {
  CREDIT_GOAL_KINDS,
  GOAL_MAX_SCORE,
  GOAL_MIN_SCORE,
  type CreditGoalKind,
} from "@/config/credit-goals";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { creditPartnerFor } from "@/lib/credit";
import type { CreditRequest } from "@/lib/credit/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import {
  buildPlan,
  goalTitle,
  monthOf,
  paydownBalances,
  planMonths,
  type GoalPlan,
} from "@/planning/credit-goal";
import { isoDay } from "@/lib/dates";

// A credit score for a goal (spec step 227). A target score and date for a mortgage, a car or
// another loan, and a monthly plan from the credit partner's score simulator (step 175): what
// to pay down and when, accounts to keep open, inquiries to avoid and, before a mortgage
// application, a rapid rescore. Each month is a checklist. Demo advice, a stand-in score;
// nothing here changes a real account.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook };

export class CreditGoalError extends Error {}

export type GoalDraft = { kind: CreditGoalKind; targetScore: number; targetDate: string };

export type GoalView = GoalDraft & {
  id: string | null;
  title: string;
  months: number;
  plan: GoalPlan;
  // This month's items with whether each is done (a saved goal only).
  thisMonth: { key: string; text: string; done: boolean }[];
  currentMonth: string;
  scoreNow: number;
};

export type CreditGoals = {
  available: boolean;
  scoreNow: number | null;
  goals: GoalView[];
};

type Report = { score: number; limit: number; request: CreditRequest };

async function latestReport(userId: string, client: PrismaClient): Promise<Report | null> {
  const row = await scopedFor(userId, client).creditReports.findFirst({
    orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
  });
  return row
    ? {
        score: row.score,
        limit: row.cardLimitCents,
        request: row.inputs as unknown as CreditRequest,
      }
    : null;
}

// The plan for a draft goal, from the latest report and the simulator.
export async function planFor(
  userId: string,
  draft: GoalDraft,
  { client = defaultClient, now = new Date(), book: given }: Options = {},
): Promise<GoalView | null> {
  const found = await creditPartnerFor(userId, { client });
  if (!found) return null;
  const report = await latestReport(userId, client);
  if (!report) return null;
  const book = await debtsOr(given, userId, { client, now });
  const asOf = isoDay(now);
  const months = planMonths(asOf, draft.targetDate);
  const balances = paydownBalances({
    balanceCents: report.request.cardBalanceCents,
    limitCents: report.limit,
    months,
  });
  const scores = new Map<number, number>();
  for (const b of new Set([report.request.cardBalanceCents, ...balances])) {
    scores.set(b, await found.partner.estimate(report.request, { cardBalanceCents: b }));
  }
  const withInquiry = await found.partner.estimate(report.request, { extraInquiries: 1 });
  const plan = buildPlan({
    asOf,
    kind: draft.kind,
    targetScore: draft.targetScore,
    balanceCents: report.request.cardBalanceCents,
    limitCents: report.limit,
    months,
    cardNames: book.debts.filter((d) => d.kind === "card" && d.inNetWorth).map((d) => d.name),
    scoreAfter: (b) => scores.get(b) ?? report.score,
    inquiryCostPoints: Math.max(0, report.score - withInquiry),
  });
  return {
    ...draft,
    id: null,
    title: goalTitle(draft.kind, draft.targetScore, draft.targetDate),
    months,
    plan,
    thisMonth: [],
    currentMonth: monthOf(asOf),
    scoreNow: report.score,
  };
}

export async function loadCreditGoals(
  userId: string,
  { client = defaultClient, now = new Date(), book }: Options = {},
): Promise<CreditGoals> {
  if (!(await creditPartnerFor(userId, { client })))
    return { available: false, scoreNow: null, goals: [] };
  const report = await latestReport(userId, client);
  const rows = await scopedFor(userId, client).creditGoals.findMany({
    where: { endedOn: null },
    orderBy: { targetDate: "asc" },
  });
  const goals: GoalView[] = [];
  for (const r of rows) {
    const view = await planFor(
      userId,
      {
        kind: (CREDIT_GOAL_KINDS as readonly string[]).includes(r.kind)
          ? (r.kind as CreditGoalKind)
          : "other",
        targetScore: r.targetScore,
        targetDate: isoDay(r.targetDate),
      },
      { client, now, book },
    );
    if (!view) continue;
    const done = new Set(Array.isArray(r.done) ? (r.done as string[]) : []);
    const current =
      view.plan.months.find((m) => m.month === view.currentMonth) ?? view.plan.months[0];
    goals.push({
      ...view,
      id: r.id,
      thisMonth: (current?.items ?? []).map((i) => ({
        key: i.key,
        text: i.text,
        done: done.has(`${current.month}:${i.key}`),
      })),
      currentMonth: current?.month ?? view.currentMonth,
    });
  }
  return { available: true, scoreNow: report?.score ?? null, goals };
}

export function checkGoalDraft(
  draft: { kind: string; targetScore: number; targetDate: string },
  asOf: string,
): GoalDraft {
  if (!(CREDIT_GOAL_KINDS as readonly string[]).includes(draft.kind)) {
    throw new CreditGoalError("Pick what the score is for.");
  }
  if (
    !Number.isInteger(draft.targetScore) ||
    draft.targetScore < GOAL_MIN_SCORE ||
    draft.targetScore > GOAL_MAX_SCORE
  ) {
    throw new CreditGoalError(`Pick a score between ${GOAL_MIN_SCORE} and ${GOAL_MAX_SCORE}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.targetDate) || draft.targetDate <= asOf) {
    throw new CreditGoalError("Pick a date after today.");
  }
  return {
    kind: draft.kind as CreditGoalKind,
    targetScore: draft.targetScore,
    targetDate: draft.targetDate,
  };
}

// The person tapped Start: the plan is saved as a goal.
export async function startCreditGoal(
  userId: string,
  input: { kind: string; targetScore: number; targetDate: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<GoalView> {
  const draft = checkGoalDraft(input, isoDay(now));
  const view = await planFor(userId, draft, { client, now });
  if (!view)
    throw new CreditGoalError("A credit goal needs a score Jane has pulled; there isn't one yet.");
  const db = scopedFor(userId, client);
  if (
    await db.creditGoals.findFirst({
      where: { endedOn: null, kind: draft.kind },
      select: { id: true },
    })
  ) {
    throw new CreditGoalError("You already have a plan for that. End it first to start a new one.");
  }
  const row = await db.creditGoals.create({
    data: {
      userId,
      name: view.title,
      kind: draft.kind,
      targetScore: draft.targetScore,
      targetDate: new Date(`${draft.targetDate}T00:00:00Z`),
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "credit_goal_started",
    { type: "credit_goal", id: row.id },
    { kind: draft.kind, target: draft.targetScore },
  );
  await track(userId, "credit_goal_started", { kind: draft.kind });
  return { ...view, id: row.id };
}

// The person ticked off what they did this month: one item, or all of them.
export async function completeGoalItems(
  userId: string,
  goalId: string,
  keys: readonly string[] | "all",
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const goals = await loadCreditGoals(userId, { client, now });
  const goal = goals.goals.find((g) => g.id === goalId);
  if (!goal) throw new CreditGoalError("That plan isn't on your list.");
  const wanted = keys === "all" ? goal.thisMonth.map((i) => i.key) : [...keys];
  const valid = goal.thisMonth
    .filter((i) => wanted.includes(i.key) && !i.done)
    .map((i) => `${goal.currentMonth}:${i.key}`);
  if (valid.length === 0) throw new CreditGoalError("Those are already ticked off.");
  const row = await db.creditGoals.findFirst({ where: { id: goalId }, select: { done: true } });
  const done = Array.isArray(row?.done) ? (row!.done as string[]) : [];
  await db.creditGoals.updateMany({ where: { id: goalId }, data: { done: [...done, ...valid] } });
  await track(userId, "credit_goal_items_done", { count: valid.length });
  return valid.length;
}

export async function endCreditGoal(
  userId: string,
  goalId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).creditGoals.updateMany({
    where: { id: goalId, endedOn: null },
    data: { endedOn: new Date(`${isoDay(now)}T00:00:00Z`) },
  });
  if (count === 0) throw new CreditGoalError("That plan isn't on your list.");
}
