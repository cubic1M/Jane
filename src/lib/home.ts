import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { YEARLY_BILLS_GOAL_PATTERN } from "@/config/irregular";
import { COMING_UP_DAYS, COMING_UP_LIMIT } from "@/config/home";
import { PLAN_SHOWN } from "@/config/areas";
import { groupsCountedElsewhere, planTotal } from "@/detection/overlap";
import { budgetSummary } from "@/insights/budgets";
import { comingUp } from "@/insights/coming-up";
import { irregularCosts } from "@/insights/irregular";
import { loadInsightTransactions } from "@/insights/load";
import { loadDetectionInput, moneyFound } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { unreadAlertCount } from "@/lib/alerts";
import { db as defaultClient } from "@/lib/db";
import { listGoals } from "@/lib/goals";
import { roomFromPlan } from "@/planning/goal-tradeoffs";
import { safeToSpend } from "@/planning/safe-to-spend";
import { scopedFor } from "@/lib/db-scoped";
import { savedItems } from "@/lib/membership/service";
import { loadComingUp } from "@/lib/coming-up";
import { whatJaneDid } from "@/lib/what-jane-did";

// Everything Today (the home dashboard) shows, for one person. Null when they have no
// accounts. Spec step 79: only what needs the person now.

export async function homeSummary(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const db = scopedFor(userId, client);
  const accounts = await db.accounts.count();
  if (accounts === 0) return null;

  // One round of reads, then one more for what needs the detection input: each step waits on the
  // database, so independent reads go together (speed pass, 2026-10-24).
  const [
    found,
    saved,
    waiting,
    openActions,
    open,
    input,
    lastSync,
    lastImport,
    alerts,
    budgets,
    janeDid,
    goals,
    plan,
  ] = await Promise.all([
    moneyFound(userId, { client }),
    savedItems(userId, { client }),
    db.actions.findMany({
      where: { status: "waiting_on_user" },
      select: { id: true, userTodo: true, decision: { select: { cardSnapshot: true } } },
      orderBy: { updatedAt: "asc" },
    }),
    db.actions.count({
      where: { status: { in: ["queued", "in_progress", "waiting_on_user"] } },
    }),
    // Jane's plan: every open finding is an item on it.
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: { status: true, title: true, annualSavingsCents: true, type: true, evidence: true },
    }),
    loadDetectionInput(userId, { client, now }),
    db.plaidItems.findFirst({
      where: { lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    db.transactions.findFirst({
      where: { source: "csv" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    unreadAlertCount(userId, { client }),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    whatJaneDid(userId, { client, now }),
    listGoals(userId, { client, now }),
    // The year plan as last kept (spec step 205): what this month has room to save.
    db.yearPlans.findFirst({ orderBy: { startMonth: "desc" }, select: { months: true } }),
  ]);
  // The person's own day, as the bills and safe to spend read it (src/lib/today.ts).
  const asOf = input.asOf;
  const [budgetRows, { bills, deposits, deadlines }] = await Promise.all([
    budgets.length === 0 ? null : loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    // Bills and deadlines from the one coming-up source, reusing the transactions loaded above.
    loadComingUp(userId, { client, now, days: COMING_UP_DAYS, input }),
  ]);
  const budget = budgetRows === null ? null : budgetSummary(budgetRows, budgets, asOf);

  // Yearly bills (spec step 70): this month's set-aside is its own line, so a "Yearly
  // bills" goal isn't counted again under goals.
  const setAsideCents = irregularCosts(input).monthlyCents;
  // Goals are counted at what they need this month, but never past what the plan has room to
  // save (books QA): goals that can't all be funded wait their turn (spec step 241) rather than
  // make the person look short.
  const goalsWant = goals.reduce(
    (sum, g) =>
      sum +
      (g.progress.status === "on_the_way" &&
      !(setAsideCents > 0 && YEARLY_BILLS_GOAL_PATTERN.test(g.name))
        ? g.progress.monthlyCents
        : 0),
    0,
  );
  const goalsCents = Math.min(goalsWant, savingRoomOf(plan?.months, asOf.slice(0, 7)) ?? goalsWant);

  const updated = [lastSync?.lastSyncedAt, lastImport?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    moneyFoundCents: found,
    savedToDateCents: saved.reduce((sum, i) => sum + i.cents, 0),
    // What the saved total is made of, biggest first (the Saved tile's summary).
    savedItems: saved,
    openActions,
    unreadAlerts: alerts,
    plan: {
      items: open.length,
      // The same total as /plan: every item's yearly saving, if the person says yes to all.
      annualSavingsCents: planTotal(open),
      // The biggest few, as the Saved tile's "Your plan" lists them (one of overlapping items).
      top: planTop(open),
    },
    // The goal savings go toward: the first one (soonest date) not reached yet.
    goal: (() => {
      const g = goals.find((g) => g.progress.status !== "reached");
      return g ? { name: g.name, percent: g.progress.percent } : null;
    })(),
    // Findings the person hasn't seen yet; seeing the plan or a card marks them seen.
    newToDecide: open.filter((f) => f.status === "new").length,
    janeDid,
    safeToSpend: input.accounts.some(
      (a) => a.type === "depository" && a.subtype === "checking" && a.currentBalanceCents !== null,
    )
      ? safeToSpend(input, {
          budgetsLeftCents: (budget?.progress ?? []).reduce(
            (sum, p) => sum + Math.max(0, p.leftCents),
            0,
          ),
          goalsCents,
          setAsideCents,
        })
      : null,
    waitingOnYou: waiting.map((a) => ({
      id: a.id,
      todo: a.userTodo,
      title:
        (a.decision.cardSnapshot as { title?: unknown } | null)?.title?.toString() ??
        "Your request",
    })),
    // Bills and deadlines in one list, soonest first (spec step 79).
    comingUp: comingUp(bills, deadlines, asOf, { days: COMING_UP_DAYS, limit: COMING_UP_LIMIT }),
    // The hub's cash-flow strip (docs/design/home-hub.md): the same bills and deadlines, and the
    // deposits expected, all of them.
    cashFlow: { bills, deposits, deadlines },
    lastUpdated: updated ?? null,
    // For Jane's heads-ups in the chat (spec step 82): the deadlines page's list, budgets
    // gone over this month and goals whose date passed short of the target.
    deadlines,
    budgetsOver: (budget?.progress ?? [])
      .filter((p) => p.over)
      .map((p) => ({ category: p.category, overCents: -p.leftCents, month: budget!.month })),
    goalsBehind: goals.flatMap((g) =>
      g.progress.status === "date_passed"
        ? [{ id: g.id, name: g.name, leftCents: g.progress.leftCents }]
        : [],
    ),
    // Spec step 83: every budget this month, for Jane's "nearly over" heads-up.
    budgetProgress: budget
      ? budget.progress.map((p) => ({
          category: p.category,
          budgetCents: p.budgetCents,
          spentCents: p.spentCents,
          month: budget.month,
        }))
      : [],
  };
}

function planTop<
  T extends { type: string; evidence: unknown; title: string; annualSavingsCents: number | null },
>(open: readonly T[]): { title: string; cents: number }[] {
  const skipped = groupsCountedElsewhere(open);
  return open
    .filter((f) => !skipped.has(f) && (f.annualSavingsCents ?? 0) > 0)
    .sort((a, b) => (b.annualSavingsCents ?? 0) - (a.annualSavingsCents ?? 0))
    .slice(0, PLAN_SHOWN)
    .map((f) => ({ title: f.title, cents: f.annualSavingsCents ?? 0 }));
}

export type HomeSummary = NonNullable<Awaited<ReturnType<typeof homeSummary>>>;

// What this month has room to save in the kept year plan (spec step 241's room: the margin less
// dated payments and extra debt payments), or null without a plan for this month.
function savingRoomOf(months: unknown, month: string): number | null {
  if (!Array.isArray(months)) return null;
  const rows = months as Parameters<typeof roomFromPlan>[0];
  return rows.some((m) => m.month === month) ? roomFromPlan(rows, month)[0] : null;
}
