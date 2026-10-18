import { MAX_MINUTES_PER_ACTION, MAX_TEAM_TEXT } from "@/config/concierge";
import type {
  ActionStatus,
  ActionType,
  FindingStatus,
  PrismaClient,
} from "@/generated/prisma/client";
import { sendStatusEmail, statusEmail } from "@/lib/action-emails";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { offerFor } from "@/lib/membership/service";

// The team's side of actions. Admin pages work across users, so these use the raw
// client; every caller must have passed requireAdmin() first, and every read of user
// data is audit-logged.

export const ACTION_STATUSES: readonly ActionStatus[] = [
  "queued",
  "in_progress",
  "waiting_on_user",
  "done",
  "failed",
];
export const OPEN_ACTION_STATUSES: readonly ActionStatus[] = [
  "queued",
  "in_progress",
  "waiting_on_user",
];
const CLOSED: readonly ActionStatus[] = ["done", "failed"];

// The finding follows its action, so the report and money-found stay in step.
const FINDING_STATUS: Record<ActionStatus, FindingStatus> = {
  queued: "approved",
  in_progress: "in_progress",
  waiting_on_user: "in_progress",
  done: "done",
  failed: "failed",
};

const EVENT: Partial<Record<ActionStatus, string>> = {
  in_progress: "action_started",
  waiting_on_user: "action_waiting",
  done: "action_done",
  failed: "action_failed",
};

export type Admin = { id: string; email?: string | null };

export type StatusChange = {
  status: ActionStatus;
  assignee: string | null;
  notes: string | null;
  minutesSpent: number | null;
  userTodo: string | null;
  failureReason: string | null;
};

export class ConciergeError extends Error {}

// Pure: the queue rules. Returns what's wrong, or null.
export function checkChange(current: ActionStatus, change: StatusChange): string | null {
  if (CLOSED.includes(current)) return "This action is closed and can't be changed.";
  for (const text of [change.notes, change.userTodo, change.failureReason, change.assignee]) {
    if (text && text.length > MAX_TEAM_TEXT) return `Keep text under ${MAX_TEAM_TEXT} characters.`;
  }
  if (CLOSED.includes(change.status)) {
    const minutes = change.minutesSpent;
    if (
      minutes === null ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_MINUTES_PER_ACTION
    ) {
      return `Enter the minutes spent (1 to ${MAX_MINUTES_PER_ACTION}) before closing.`;
    }
  }
  if (change.status === "failed" && !change.failureReason) {
    return "Say why it failed, so the card and rules can be fixed.";
  }
  if (change.status === "waiting_on_user" && !change.userTodo) {
    return "Say exactly what the person needs to do.";
  }
  return null;
}

const titleOf = (snapshot: unknown): string => {
  const title = (snapshot as { title?: unknown } | null)?.title;
  return typeof title === "string" ? title : "Your request";
};

type Options = { client?: PrismaClient; now?: Date; notify?: typeof sendStatusEmail };

export async function changeActionStatus(
  admin: Admin,
  actionId: string,
  change: StatusChange,
  { client = defaultClient, now = new Date(), notify = sendStatusEmail }: Options = {},
): Promise<void> {
  const action = await client.action.findUnique({
    where: { id: actionId },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      startedAt: true,
      decision: { select: { findingId: true, cardSnapshot: true } },
      user: { select: { email: true } },
    },
  });
  if (!action) throw new ConciergeError("That action doesn't exist.");
  const problem = checkChange(action.status, change);
  if (problem) throw new ConciergeError(problem);

  const moved = change.status !== action.status;
  const closing = CLOSED.includes(change.status);
  await client.$transaction([
    client.action.update({
      where: { id: action.id },
      data: {
        status: change.status,
        assignee: change.assignee,
        notes: change.notes,
        userTodo: change.status === "waiting_on_user" ? change.userTodo : null,
        failureReason: change.status === "failed" ? change.failureReason : null,
        minutesSpent: closing ? change.minutesSpent : null,
        startedAt: action.startedAt ?? (change.status !== "queued" ? now : null),
        completedAt: closing ? now : null,
      },
    }),
    client.finding.updateMany({
      where: { id: action.decision.findingId, userId: action.userId },
      data: { status: FINDING_STATUS[change.status] },
    }),
  ]);

  await logAudit(
    { type: "admin", id: admin.id },
    "action_status_changed",
    { type: "action", id: action.id },
    { from: action.status, to: change.status, user_id: action.userId },
  );
  if (!moved) return;

  const event = EVENT[change.status];
  if (event) {
    await track(action.userId, event, {
      action_type: action.type,
      minutes_spent: closing ? change.minutesSpent : null,
    });
  }
  // The first finished action is when the membership offer starts (spec step 10).
  const membershipOffer =
    change.status === "done" && (await offerFor(action.userId, { client, now })).show;
  const email = statusEmail(change.status, titleOf(action.decision.cardSnapshot), change.userTodo, {
    membershipOffer,
  });
  if (email && action.user.email) {
    try {
      await notify(action.user.email, email);
    } catch (error) {
      // The status change stands; the person still sees it on /actions.
      console.error("Status email failed", { actionId: action.id, error: String(error) });
    }
  }
}

export type QueueFilter = { type: ActionType | null; status: ActionStatus | null };

export async function listQueue(
  admin: Admin,
  filter: QueueFilter,
  { client = defaultClient }: Pick<Options, "client"> = {},
) {
  const actions = await client.action.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
      status: filter.status ? filter.status : { in: [...OPEN_ACTION_STATUSES] },
    },
    select: {
      id: true,
      type: true,
      status: true,
      assignee: true,
      createdAt: true,
      user: { select: { email: true } },
      decision: { select: { cardSnapshot: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  await logAudit({ type: "admin", id: admin.id }, "admin_viewed_queue", null, {
    type: filter.type,
    status: filter.status,
    count: actions.length,
  });
  return actions.map((a) => ({ ...a, title: titleOf(a.decision.cardSnapshot) }));
}

export async function getActionForAdmin(
  admin: Admin,
  actionId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
) {
  const action = await client.action.findUnique({
    where: { id: actionId },
    include: {
      user: { select: { email: true } },
      decision: {
        select: {
          cardSnapshot: true,
          createdAt: true,
          finding: { select: { evidence: true, type: true } },
        },
      },
    },
  });
  if (!action) return null;
  await logAudit(
    { type: "admin", id: admin.id },
    "admin_viewed_action",
    { type: "action", id: action.id },
    { user_id: action.userId },
  );
  return action;
}
