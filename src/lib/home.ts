import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { HOME_LIST_LIMIT, UPCOMING_DAYS } from "@/config/home";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { loadDetectionInput, moneyFound } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { unreadAlertCount } from "@/lib/alerts";
import { db as defaultClient } from "@/lib/db";
import { listGoals } from "@/lib/goals";
import { scopedFor } from "@/lib/db-scoped";
import { savedToDate } from "@/lib/membership/service";
import { upcomingCharges } from "@/lib/upcoming";

// Everything the home dashboard shows, for one person. Null when they have no accounts.

export async function homeSummary(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const db = scopedFor(userId, client);
  const accounts = await db.accounts.count();
  if (accounts === 0) return null;

  const [
    found,
    saved,
    waiting,
    openActions,
    findings,
    input,
    lastSync,
    lastImport,
    alerts,
    budgets,
  ] = await Promise.all([
    moneyFound(userId, { client }),
    savedToDate(userId, { client }),
    db.actions.findMany({
      where: { status: "waiting_on_user" },
      select: { id: true, userTodo: true, decision: { select: { cardSnapshot: true } } },
      orderBy: { updatedAt: "asc" },
    }),
    db.actions.count({ where: { status: { in: ["queued", "in_progress", "waiting_on_user"] } } }),
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: { id: true, type: true, title: true, annualSavingsCents: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: HOME_LIST_LIMIT,
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

  const updated = [lastSync?.lastSyncedAt, lastImport?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    moneyFoundCents: found,
    savedToDateCents: saved,
    openActions,
    unreadAlerts: alerts,
    budgets: budget ? { progress: budget.progress, daysLeft: budget.daysLeft } : null,
    goals: goals.map((g) => ({ id: g.id, name: g.name, percent: g.progress.percent })),
    waitingOnYou: waiting.map((a) => ({
      id: a.id,
      todo: a.userTodo,
      title:
        (a.decision.cardSnapshot as { title?: unknown } | null)?.title?.toString() ??
        "Your request",
    })),
    newestFindings: findings,
    upcoming: upcomingCharges(input, { days: UPCOMING_DAYS, limit: HOME_LIST_LIMIT }),
    lastUpdated: updated ?? null,
  };
}

export type HomeSummary = NonNullable<Awaited<ReturnType<typeof homeSummary>>>;
