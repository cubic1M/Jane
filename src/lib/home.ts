import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { YEARLY_BILLS_GOAL_PATTERN } from "@/config/irregular";
import { COMING_UP_DAYS, COMING_UP_LIMIT } from "@/config/home";
import { budgetSummary } from "@/insights/budgets";
import { comingUp } from "@/insights/coming-up";
import { irregularCosts } from "@/insights/irregular";
import { loadInsightTransactions } from "@/insights/load";
import { loadDetectionInput, moneyFound } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { unreadAlertCount } from "@/lib/alerts";
import { db as defaultClient } from "@/lib/db";
import {
  DEADLINE_SOURCES,
  listDeadlines,
  transactionDeadlines,
  transactionDeadlinesFrom,
} from "@/lib/deadlines";
import { listGoals } from "@/lib/goals";
import { safeToSpend } from "@/planning/safe-to-spend";
import { scopedFor } from "@/lib/db-scoped";
import { savedToDate } from "@/lib/membership/service";
import { upcomingCharges } from "@/lib/upcoming";
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

  const [found, saved, waiting, openActions, open, input, lastSync, lastImport, alerts, budgets] =
    await Promise.all([
      moneyFound(userId, { client }),
      savedToDate(userId, { client }),
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
        select: { status: true, annualSavingsCents: true },
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
    ]);
  const janeDid = await whatJaneDid(userId, { client, now });
  const goals = await listGoals(userId, { client, now });
  const asOf = now.toISOString().slice(0, 10);
  const budget =
    budgets.length === 0
      ? null
      : budgetSummary(
          await loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
          budgets,
          asOf,
        );
  // The deadlines page's own list, reusing the transactions loaded above.
  const deadlines = await listDeadlines(userId, {
    client,
    now,
    sources: DEADLINE_SOURCES.map((source) =>
      source === transactionDeadlines ? transactionDeadlinesFrom(input) : source,
    ),
  });

  // Yearly bills (spec step 70): this month's set-aside is its own line, so a "Yearly
  // bills" goal isn't counted again under goals.
  const setAsideCents = irregularCosts(input).monthlyCents;

  const updated = [lastSync?.lastSyncedAt, lastImport?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    moneyFoundCents: found,
    savedToDateCents: saved,
    openActions,
    unreadAlerts: alerts,
    plan: {
      items: open.length,
      // The same total as /plan: every item's yearly saving, if the person says yes to all.
      annualSavingsCents: open.reduce((sum, f) => sum + (f.annualSavingsCents ?? 0), 0),
    },
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
          goalsCents: goals.reduce(
            (sum, g) =>
              sum +
              (g.progress.status === "on_the_way" &&
              !(setAsideCents > 0 && YEARLY_BILLS_GOAL_PATTERN.test(g.name))
                ? g.progress.monthlyCents
                : 0),
            0,
          ),
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
    comingUp: comingUp(
      upcomingCharges(input, { days: COMING_UP_DAYS, limit: Number.POSITIVE_INFINITY }),
      deadlines,
      asOf,
      { days: COMING_UP_DAYS, limit: COMING_UP_LIMIT },
    ),
    lastUpdated: updated ?? null,
  };
}

export type HomeSummary = NonNullable<Awaited<ReturnType<typeof homeSummary>>>;
