import {
  MAX_MINUTES_PER_ACTION,
  MAX_TEAM_TEXT,
  TURNAROUND_BUSINESS_DAYS,
} from "@/config/concierge";
import type { ActionStatus, ActionType, PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail, statusEmail } from "@/lib/action-emails";
import { textNeedsYou } from "@/lib/messaging/texts";
import { FINDING_STATUS } from "@/lib/action-status";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { isOverdue } from "@/lib/business-days";
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
      assignee: true,
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
  if ((change.assignee ?? null) !== (action.assignee ?? null)) {
    const ids = await adminIdsByEmail([action.assignee, change.assignee], client);
    await logAudit(
      { type: "admin", id: admin.id },
      "action_assigned",
      { type: "action", id: action.id },
      {
        from: assigneeForAudit(action.assignee, ids),
        to: assigneeForAudit(change.assignee, ids),
        user_id: action.userId,
      },
    );
  }
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
  // A text too, when the person turned them on (spec step 78).
  if (change.status === "waiting_on_user") {
    await textNeedsYou(action.userId, titleOf(action.decision.cardSnapshot), {
      client,
      now,
    }).catch((error) =>
      console.error("Needs-you text failed", { actionId: action.id, error: String(error) }),
    );
  }
}

export type QueueFilter = {
  type: ActionType | null;
  status: ActionStatus | null;
  // An assignee's email, "unassigned", or null for everyone.
  assignee?: string | null;
};

// The team's members: the admins, by email. Only they can be assigned actions.
export async function teamMembers({ client = defaultClient }: Pick<Options, "client"> = {}) {
  const admins = await client.user.findMany({
    where: { role: "admin", deletedAt: null },
    select: { email: true },
    orderBy: { email: "asc" },
  });
  return admins.map((a) => a.email);
}

export type WorkloadRow = { assignee: string | null; open: number; overdue: number };

export async function loadWorkload({
  client = defaultClient,
  now = new Date(),
}: Pick<Options, "client" | "now"> = {}): Promise<WorkloadRow[]> {
  const open = await client.action.findMany({
    where: {
      status: { in: [...OPEN_ACTION_STATUSES] },
      OR: [{ agentState: null }, { agentState: "handed_off" }],
    },
    select: { assignee: true, status: true, createdAt: true },
  });
  return workload(open, now);
}

// Pure: open actions per assignee (unassigned last), and how many are overdue by the
// queue's own rule (still queued after TURNAROUND_BUSINESS_DAYS).
export function workload(
  actions: { assignee: string | null; status: ActionStatus; createdAt: Date }[],
  now: Date,
): WorkloadRow[] {
  const rows = new Map<string | null, WorkloadRow>();
  for (const a of actions) {
    if (!(OPEN_ACTION_STATUSES as readonly string[]).includes(a.status)) continue;
    const row = rows.get(a.assignee) ?? { assignee: a.assignee, open: 0, overdue: 0 };
    row.open += 1;
    if (a.status === "queued" && isOverdue(a.createdAt, TURNAROUND_BUSINESS_DAYS, now)) {
      row.overdue += 1;
    }
    rows.set(a.assignee, row);
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.assignee === null) - Number(b.assignee === null) ||
      (a.assignee ?? "").localeCompare(b.assignee ?? ""),
  );
}

export async function listQueue(
  admin: Admin,
  filter: QueueFilter,
  { client = defaultClient }: Pick<Options, "client"> = {},
) {
  const actions = await client.action.findMany({
    where: {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.assignee
        ? { assignee: filter.assignee === "unassigned" ? null : filter.assignee }
        : {}),
      status: filter.status ? filter.status : { in: [...OPEN_ACTION_STATUSES] },
      // Open work the agent is still doing isn't the team's; what it hands off is.
      ...(filter.status === null || OPEN_ACTION_STATUSES.includes(filter.status)
        ? { OR: [{ agentState: null }, { agentState: "handed_off" as const }] }
        : {}),
    },
    select: {
      id: true,
      type: true,
      status: true,
      assignee: true,
      createdAt: true,
      handoffReason: true,
      userId: true,
      user: { select: { email: true } },
      decision: { select: { cardSnapshot: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  // An action whose person was deleted mid-request comes back without its decision.
  const shown = actions.filter((a) => a.decision);
  await logQueueView(admin, filter, shown, client);
  return shown.map((a) => ({ ...a, title: titleOf(a.decision.cardSnapshot) }));
}

// Audit metadata holds ids only, so an assignee (a team member's email) is recorded as
// that admin's user id, or NOT_ON_TEAM when no admin has that email any more. "unassigned"
// and null stay as they are.
export const NOT_ON_TEAM = "not_on_team";

async function adminIdsByEmail(
  emails: (string | null | undefined)[],
  client: PrismaClient,
): Promise<Map<string, string>> {
  const wanted = emails.filter((e): e is string => !!e && e !== "unassigned");
  if (wanted.length === 0) return new Map();
  const admins = await client.user.findMany({
    where: { role: "admin", email: { in: wanted } },
    select: { id: true, email: true },
  });
  return new Map(admins.flatMap((a) => (a.email ? [[a.email, a.id] as const] : [])));
}

function assigneeForAudit(
  assignee: string | null | undefined,
  ids: Map<string, string>,
): string | null {
  if (!assignee) return null;
  if (assignee === "unassigned") return assignee;
  return ids.get(assignee) ?? NOT_ON_TEAM;
}

// One admin_viewed_queue entry per person whose actions were listed, naming those actions,
// so each person sees the view on /settings/team-access (spec step 74). An empty queue
// still logs the view, about no one.
async function logQueueView(
  admin: Admin,
  filter: QueueFilter,
  shown: { id: string; userId: string }[],
  client: PrismaClient,
) {
  const actor = { type: "admin" as const, id: admin.id };
  const metadata = {
    type: filter.type,
    status: filter.status,
    assignee: assigneeForAudit(filter.assignee, await adminIdsByEmail([filter.assignee], client)),
    count: shown.length,
  };
  if (shown.length === 0) return logAudit(actor, "admin_viewed_queue", null, metadata);
  const byPerson = Map.groupBy(shown, (a) => a.userId);
  await Promise.all(
    [...byPerson].map(([userId, theirs]) =>
      logAudit(
        actor,
        "admin_viewed_queue",
        { type: "user", id: userId },
        { ...metadata, action_ids: theirs.map((a) => a.id).join(",") },
      ),
    ),
  );
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
          options: true,
          source: true,
          finding: { select: { evidence: true, type: true } },
        },
      },
      agentMessages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          toAddress: true,
          fromAddress: true,
          subject: true,
          body: true,
          summary: true,
          createdAt: true,
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
