import {
  HUB_ALERTS_LIMIT,
  HUB_DECIDE_LIMIT,
  HUB_DONE_LIMIT,
  HUB_IN_PROGRESS_LIMIT,
} from "@/config/hubs";
import type { ActionStatus, PrismaClient } from "@/generated/prisma/client";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { newestUnreadAlerts, unreadAlertCount } from "@/lib/alerts";
import { comparisonsFor } from "@/lib/compare";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { savedToDate } from "@/lib/membership/service";
import { formatCents } from "@/lib/money";
import { planFor } from "@/lib/plan";
import { savingsLine } from "@/lib/savings-text";
import type { Comparison } from "@/planning/compare";

// The Jane hub (spec step 80): what Jane found and is doing, in four short lists, each with
// a "See all" to its full page. Reads only; seeing the hub doesn't mark cards or alerts seen.

type Options = { client?: PrismaClient; now?: Date };

export type DecideItem = { findingId: string; title: string; savings: string; pick: string | null };
export type ProgressItem = {
  id: string;
  title: string;
  status: ActionStatus;
  label: string;
  todo: string | null;
};
export type DoneItem = { id: string; title: string; saving: string | null };

const OPEN_STATUSES: ActionStatus[] = ["queued", "in_progress", "waiting_on_user"];
// Waiting on the person first, then what the team is working on, then the queue.
const STATUS_ORDER: Record<ActionStatus, number> = {
  waiting_on_user: 0,
  in_progress: 1,
  queued: 2,
  done: 3,
  failed: 4,
};

// Jane's pick from the comparison, as one short line.
export function pickLine(comparison: Comparison | null): string | null {
  if (!comparison) return null;
  const { pick } = comparison;
  return comparison.current.kind === "savings"
    ? `Jane's pick: ${pick.option.name}, earns about ${formatCents(pick.savingCents)} more a year`
    : `Jane's pick: ${pick.option.name}, saves about ${formatCents(pick.savingCents)} in the first year`;
}

// The card's title as the person agreed to it.
export function snapshotTitle(snapshot: unknown): string {
  const title = (snapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" && title !== "" ? title : "Your request";
}

// What a finished action saved: a refund seen in the transactions, a lower price confirmed
// on a call, or else the card's estimate (the same order as savedToDate).
export function doneSaving(action: {
  refundCents: number | null;
  confirmedAnnualCents: number | null;
  cardSnapshot: unknown;
}): string | null {
  if (action.refundCents !== null) return `Got back ${formatCents(action.refundCents)}`;
  if (action.confirmedAnnualCents !== null) {
    return `Saves ${formatCents(action.confirmedAnnualCents)} a year, confirmed`;
  }
  const estimate = (action.cardSnapshot as { annualSavingsCents?: unknown } | null)
    ?.annualSavingsCents;
  return typeof estimate === "number" && estimate > 0
    ? `About ${formatCents(estimate)} a year`
    : null;
}

// Open actions, waiting on the person first; newest first within each status.
export function orderInProgress<T extends { status: ActionStatus; createdAt: Date }>(
  actions: T[],
): T[] {
  return [...actions].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export async function loadJaneHub(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const [plan, open, doneCount, done, saved, alerts, unread] = await Promise.all([
    planFor(userId, { client }),
    db.actions.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        status: true,
        userTodo: true,
        createdAt: true,
        decision: { select: { cardSnapshot: true } },
      },
    }),
    db.actions.count({ where: { status: "done" } }),
    db.actions.findMany({
      where: { status: "done" },
      select: {
        id: true,
        refundCents: true,
        confirmedAnnualCents: true,
        decision: { select: { cardSnapshot: true } },
      },
      orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      take: HUB_DONE_LIMIT,
    }),
    savedToDate(userId, { client }),
    newestUnreadAlerts(userId, { client, limit: HUB_ALERTS_LIMIT }),
    unreadAlertCount(userId, { client }),
  ]);

  // Jane's pick for the cards shown, from the finding's own evidence.
  const top = plan.slice(0, HUB_DECIDE_LIMIT);
  const findings = await db.findings.findMany({
    where: { id: { in: top.map((i) => i.card.findingId) } },
    select: { id: true, type: true, evidence: true },
  });
  const byId = new Map(findings.map((f) => [f.id, f]));
  const comparisons = await comparisonsFor(
    top.map((i) => byId.get(i.card.findingId) ?? { type: i.card.findingType, evidence: null }),
    { userId, client, now },
  );

  return {
    decide: {
      total: plan.length,
      totalSavingsCents: plan.reduce((sum, i) => sum + (i.card.annualSavingsCents ?? 0), 0),
      items: top.map((i, index): DecideItem => ({
        findingId: i.card.findingId,
        title: i.card.title,
        savings: savingsLine(i.card.findingType, i.card.annualSavingsCents),
        pick: pickLine(comparisons[index]),
      })),
    },
    inProgress: {
      total: open.length,
      items: orderInProgress(open)
        .slice(0, HUB_IN_PROGRESS_LIMIT)
        .map((a): ProgressItem => ({
          id: a.id,
          title: snapshotTitle(a.decision.cardSnapshot),
          status: a.status,
          label: ACTION_STATUS_LABELS[a.status].label,
          todo: a.status === "waiting_on_user" ? a.userTodo : null,
        })),
    },
    done: {
      total: doneCount,
      savedToDateCents: saved,
      items: done.map((a): DoneItem => ({
        id: a.id,
        title: snapshotTitle(a.decision.cardSnapshot),
        saving: doneSaving({ ...a, cardSnapshot: a.decision.cardSnapshot }),
      })),
    },
    alerts: {
      unread,
      items: alerts.map((a) => ({ id: a.id, title: a.title, body: a.body })),
    },
  };
}
