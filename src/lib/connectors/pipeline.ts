import { createHash } from "node:crypto";
import {
  CONNECTOR_ACTION_CAP_CENTS,
  CONNECTOR_DAILY_ACTIONS,
  CONNECTOR_DAILY_CENTS,
  CONNECTOR_HOLD_MINUTES,
  CONNECTOR_PLAN_HOURS,
} from "@/config/connectors";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR, type AuditActor, type AuditEvent } from "@/lib/audit";
import { onSampleDataOnly } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { enqueueJob } from "@/lib/jobs";
import { consentCovers, currentConsentId } from "./consent";
import { withGrant } from "./gate";
import { connectorById, mayMoveRealMoney, whyUnavailable, type Unavailable } from "./registry";
import {
  BadRequest,
  type ActContext,
  type ActionDetails,
  type ActionDraft,
  type CheckContext,
  type Connector,
  type PrefilledStep,
  type WebhookEvent,
} from "./types";
import { NoCredential, withCredential } from "./vault";

// The one way anything happens through a connector (docs/connectors.md):
//
//   plan     the connector fills in the steps; nothing is sent        -> awaiting_yes
//   answer   the person's yes on exactly that action and amount, or no -> approved | declined
//   hold     it waits CONNECTOR_HOLD_MINUTES, cancellable in Jane      (the jobs queue's run_at)
//   execute  every check again, then the connector acts in a grant     -> succeeded | partner_pending
//                                                                        | refused | failed
//
// Each move between statuses is a compare-and-set on the status before it, so two taps, two job
// runners or a retry can't act twice. Every step writes to audit_log and analytics_events. The
// connector's acting methods only work inside this file's grant (./gate.ts).

export type ConnectorStatus =
  | "awaiting_yes"
  | "approved"
  | "running"
  | "partner_pending"
  // The last step is the person's: the steps are theirs to follow (ActResult "handed_off").
  | "handed_off"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "declined"
  | "refused"
  | "reversed";

export type RefuseReason =
  | Unavailable
  | "unknown"
  | "cant_do"
  | "no_consent"
  | "bad_request"
  // A connector's own check against the person's data said no (Connector.prepare / guard).
  | "check_failed"
  | "bad_amount"
  | "over_cap"
  | "daily_count"
  | "daily_amount"
  | "changed"
  | "expired"
  | "not_waiting"
  | "key_reused"
  | "no_real_money";

const REFUSED_WORDS: Record<RefuseReason, string> = {
  off: "Connections aren't on yet.",
  killed: "Connections are paused for a moment.",
  switched_off: "That connection isn't on yet.",
  trial: "Try Jane uses sample data, so nothing real is sent.",
  sandbox_for_samples: "That connection only works with sample data.",
  real_for_real: "Sample data never goes to a real company.",
  unknown: "Jane doesn't know that connection.",
  cant_do: "That connection can't do that.",
  no_consent: "You haven't allowed that connection to do this.",
  bad_request: "Some of that is missing or doesn't fit together.",
  check_failed: "That doesn't check out against your accounts: it could pay twice, or isn't yours.",
  bad_amount: "That amount doesn't look right.",
  over_cap: "That's more than Jane can do in one go.",
  daily_count: "That's more actions than Jane does in one day.",
  daily_amount: "That's more than Jane moves in one day.",
  changed: "That changed since you saw it. Check it again.",
  expired: "That's too old to act on. Ask again.",
  not_waiting: "That's already been answered.",
  key_reused: "That was already asked for, differently.",
  no_real_money: "Jane doesn't move real money yet.",
};

export class ConnectorRefused extends Error {
  constructor(readonly reason: RefuseReason) {
    super(REFUSED_WORDS[reason]);
    this.name = "ConnectorRefused";
  }
}

type Options = { client?: PrismaClient; now?: Date };

const MINUTE = 60 * 1000;
// Statuses that count against the daily caps: said yes to, running, or done.
const COUNTED: ConnectorStatus[] = ["approved", "running", "partner_pending", "succeeded"];

// What a yes is for. Sorted keys, so the same draft always gives the same fingerprint.
export function fingerprintOf(connectorId: string, draft: Omit<ActionDraft, "summary" | "steps">) {
  const details = Object.fromEntries(
    Object.entries(draft.details).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return createHash("sha256")
    .update(JSON.stringify([connectorId, draft.kind, draft.amountCents, details]))
    .digest("hex");
}

const auditStep = (
  actor: AuditActor,
  event: AuditEvent,
  userId: string,
  metadata: Record<string, string | number | boolean | null>,
) => logAudit(actor, event, { type: "user", id: userId }, metadata);

const person = (userId: string): AuditActor => ({ type: "user", id: userId });

// Whether this connector may serve this person now: the flags, the kill switches, who they are.
async function usable(userId: string, connectorId: string, client: PrismaClient) {
  const connector = connectorById(connectorId);
  if (!connector) throw new ConnectorRefused("unknown");
  const sampleData = await onSampleDataOnly(userId, { client });
  const why = whyUnavailable(connector, { userId, sampleData });
  if (why) throw new ConnectorRefused(why);
  return connector;
}

async function withinDailyCaps(
  userId: string,
  cents: number,
  { client, now, except }: { client: PrismaClient; now: Date; except?: string },
) {
  const since = new Date(now.getTime() - 24 * 60 * MINUTE);
  // Said yes to in the last day, or run (or due to run) since then: a money action's hold is a whole
  // day, so counting yeses alone would let it run alongside a day's worth of new ones.
  const counted = await scopedFor(userId, client).connectorActions.findMany({
    where: {
      status: { in: COUNTED },
      OR: [{ approvedAt: { gte: since } }, { runAt: { gte: since } }],
      ...(except && { id: { not: except } }),
    },
    select: { amountCents: true },
  });
  if (counted.length + 1 > CONNECTOR_DAILY_ACTIONS) throw new ConnectorRefused("daily_count");
  const total = counted.reduce((sum, row) => sum + row.amountCents, 0) + cents;
  if (total > CONNECTOR_DAILY_CENTS) throw new ConnectorRefused("daily_amount");
}

function checkAmount(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new ConnectorRefused("bad_amount");
  if (cents > CONNECTOR_ACTION_CAP_CENTS) throw new ConnectorRefused("over_cap");
}

// The connector's own check against the person's data, again at the yes and before acting.
async function runGuard(
  connector: Connector,
  details: ActionDetails,
  context: CheckContext & { actionId: string },
) {
  if (!connector.guard) return;
  try {
    await connector.guard(details, context);
  } catch (error) {
    if (error instanceof BadRequest) throw new ConnectorRefused("check_failed");
    throw error;
  }
}

export type PlannedAction = {
  id: string;
  connectorId: string;
  summary: string;
  steps: PrefilledStep[];
  amountCents: number;
  fingerprint: string;
  status: string;
};

const PLANNED_SELECT = {
  id: true,
  connectorId: true,
  summary: true,
  steps: true,
  amountCents: true,
  fingerprint: true,
  status: true,
} as const;

const asPlanned = (row: {
  id: string;
  connectorId: string;
  summary: string;
  steps: Prisma.JsonValue;
  amountCents: number;
  fingerprint: string;
  status: string;
}): PlannedAction => ({ ...row, steps: row.steps as PrefilledStep[] });

// Plan: the connector fills in the steps for the person to check. Sends nothing. Asking again with
// the same idempotency key returns the first plan, or refuses if it asked for something else.
export async function planAction(
  userId: string,
  connectorId: string,
  request: ActionDetails,
  {
    idempotencyKey,
    dryRun = false,
    client = defaultClient,
    now = new Date(),
  }: Options & { idempotencyKey: string; dryRun?: boolean },
): Promise<PlannedAction> {
  const connector = await usable(userId, connectorId, client);
  if (!connector.prefill || !connector.capabilities.includes("prefill")) {
    throw new ConnectorRefused("cant_do");
  }
  if (!(await consentCovers(userId, connector, { client }))) {
    throw new ConnectorRefused("no_consent");
  }
  // The plan already made with this key, if any: its own row isn't a twin of itself.
  const prior = await scopedFor(userId, client).connectorActions.findFirst({
    where: { idempotencyKey },
    select: { id: true },
  });
  let draft: ActionDraft;
  try {
    const checked = connector.prepare
      ? await connector
          .prepare(request, { userId, client, now, ...(prior && { actionId: prior.id }) })
          .catch((error: unknown) => {
            throw error instanceof BadRequest ? new ConnectorRefused("check_failed") : error;
          })
      : request;
    draft = connector.prefill(checked);
  } catch (error) {
    if (error instanceof BadRequest) throw new ConnectorRefused("bad_request");
    throw error;
  }
  checkAmount(draft.amountCents);
  const fingerprint = fingerprintOf(connector.id, draft);
  const db = scopedFor(userId, client);
  const existing = await db.connectorActions.findFirst({
    where: { idempotencyKey },
    select: PLANNED_SELECT,
  });
  if (existing) {
    if (existing.fingerprint !== fingerprint || existing.connectorId !== connector.id) {
      throw new ConnectorRefused("key_reused");
    }
    return asPlanned(existing);
  }
  let row;
  try {
    row = await db.connectorActions.create({
      data: {
        userId,
        connectorId: connector.id,
        kind: draft.kind,
        amountCents: draft.amountCents,
        summary: draft.summary.slice(0, 300),
        steps: draft.steps as unknown as Prisma.InputJsonValue,
        details: draft.details as Prisma.InputJsonValue,
        fingerprint,
        idempotencyKey,
        dryRun,
        simulated: connector.sandbox || dryRun,
        expiresAt: new Date(now.getTime() + CONNECTOR_PLAN_HOURS * 60 * MINUTE),
        createdAt: now,
      },
      select: PLANNED_SELECT,
    });
  } catch (error) {
    // Two plans with one key at once: the other one won.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return planAction(userId, connectorId, request, { idempotencyKey, dryRun, client, now });
    }
    throw error;
  }
  await auditStep(person(userId), "connector_action_planned", userId, {
    connector: connector.id,
    action: row.id,
    kind: draft.kind,
    cents: draft.amountCents,
    dry_run: dryRun,
  });
  await track(userId, "connector_action_planned", {
    connector: connector.id,
    kind: draft.kind,
    dry_run: dryRun,
  });
  return asPlanned(row);
}

async function refuse(
  userId: string,
  actionId: string,
  from: ConnectorStatus,
  reason: RefuseReason,
  { client, now }: { client: PrismaClient; now: Date },
) {
  const { count } = await scopedFor(userId, client).connectorActions.updateMany({
    where: { id: actionId, status: from },
    data: { status: "refused", reason, finishedAt: now },
  });
  if (count === 0) return;
  await auditStep(SYSTEM_ACTOR, "connector_action_refused", userId, { action: actionId, reason });
  await track(userId, "connector_action_refused", { reason });
}

export type Answer =
  // The yes carries what the person saw: the amount and the fingerprint on the card.
  { yes: true; amountCents: number; fingerprint: string } | { yes: false };

// The person's answer. A yes must name this exact action and amount; then it waits out the hold and
// goes on the jobs queue. A second tap finds it already answered and does nothing.
export async function answerAction(
  userId: string,
  actionId: string,
  answer: Answer,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ConnectorStatus> {
  const db = scopedFor(userId, client);
  const action = await db.connectorActions.findFirst({
    where: { id: actionId },
    select: {
      connectorId: true,
      status: true,
      amountCents: true,
      fingerprint: true,
      expiresAt: true,
      kind: true,
      details: true,
    },
  });
  if (!action) throw new ConnectorRefused("not_waiting");
  if (action.status !== "awaiting_yes") return action.status as ConnectorStatus;

  if (!answer.yes) {
    const { count } = await db.connectorActions.updateMany({
      where: { id: actionId, status: "awaiting_yes" },
      data: { status: "declined", finishedAt: now },
    });
    if (count === 1) {
      await auditStep(person(userId), "connector_action_declined", userId, { action: actionId });
      await track(userId, "connector_action_declined", { connector: action.connectorId });
    }
    return "declined";
  }

  if (action.expiresAt <= now) {
    await refuse(userId, actionId, "awaiting_yes", "expired", { client, now });
    throw new ConnectorRefused("expired");
  }
  if (answer.amountCents !== action.amountCents || answer.fingerprint !== action.fingerprint) {
    throw new ConnectorRefused("changed");
  }
  const connector = await usable(userId, action.connectorId, client);
  if (!(await consentCovers(userId, connector, { client }))) {
    throw new ConnectorRefused("no_consent");
  }
  checkAmount(action.amountCents);
  await withinDailyCaps(userId, action.amountCents, { client, now, except: actionId });
  await runGuard(connector, action.details as ActionDetails, { userId, client, now, actionId });

  const hold = connector.movesMoney ? CONNECTOR_HOLD_MINUTES.money : CONNECTOR_HOLD_MINUTES.other;
  const runAt = new Date(now.getTime() + hold * MINUTE);
  const { count } = await db.connectorActions.updateMany({
    where: { id: actionId, status: "awaiting_yes" },
    data: {
      status: "approved",
      approvedAt: now,
      approvedCents: answer.amountCents,
      consentId: await currentConsentId(userId, connector.id, { client }),
      runAt,
    },
  });
  // The other tap got there first, and queued it.
  if (count === 0) return "approved";
  await enqueueJob("connector_execute", { userId, actionId }, { client, now, runAt });
  await auditStep(person(userId), "connector_action_approved", userId, {
    connector: connector.id,
    action: actionId,
    cents: action.amountCents,
    run_at: runAt.toISOString(),
  });
  await track(userId, "connector_action_approved", {
    connector: connector.id,
    kind: action.kind,
  });
  return "approved";
}

const contextFor = (userId: string, connectorId: string, actionId: string, now: Date) =>
  ({
    userId,
    actionId,
    idempotencyKey: `jane_${actionId}`,
    now,
    withSecret: (use) => withCredential(userId, connectorId, use, { now }),
  }) satisfies ActContext;

// Cancel: before it runs, in Jane, always (flags and kill switches don't stop a cancel). After, at
// the partner, while it says it can still take it back.
export async function cancelAction(
  userId: string,
  actionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const before = await db.connectorActions.updateMany({
    where: { id: actionId, status: { in: ["awaiting_yes", "approved"] } },
    data: { status: "cancelled", finishedAt: now },
  });
  let cancelled = before.count === 1;
  if (!cancelled) {
    const action = await db.connectorActions.findFirst({
      where: { id: actionId, status: { in: ["partner_pending", "succeeded"] } },
      select: { connectorId: true, externalRef: true, cancelUntil: true, simulated: true },
    });
    const connector = action && connectorById(action.connectorId);
    if (!action?.externalRef || !action.cancelUntil || action.cancelUntil <= now || !connector) {
      return false;
    }
    if (!connector.cancel) return false;
    const { externalRef } = action;
    const taken = await withGrant({ connectorId: connector.id, actionId, userId }, () =>
      connector.cancel!(externalRef, contextFor(userId, connector.id, actionId, now)),
    );
    if (!taken) return false;
    const after = await db.connectorActions.updateMany({
      where: { id: actionId, status: { in: ["partner_pending", "succeeded"] } },
      data: { status: "cancelled", finishedAt: now },
    });
    cancelled = after.count === 1;
  }
  if (cancelled) {
    await auditStep(person(userId), "connector_action_cancelled", userId, { action: actionId });
    await track(userId, "connector_action_cancelled", {});
  }
  return cancelled;
}

export type ExecuteResult = ConnectorStatus | "skipped";

// The job: every check again, as late as possible, then the connector acts inside the grant. Runs
// at most once: the move from approved to running is the claim.
export async function executeAction(
  userId: string,
  actionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ExecuteResult> {
  const db = scopedFor(userId, client);
  const claim = await db.connectorActions.updateMany({
    where: { id: actionId, status: "approved", runAt: { lte: now } },
    data: { status: "running" },
  });
  if (claim.count === 0) return "skipped";
  const action = await db.connectorActions.findFirstOrThrow({
    where: { id: actionId },
    select: {
      connectorId: true,
      kind: true,
      amountCents: true,
      approvedCents: true,
      fingerprint: true,
      summary: true,
      steps: true,
      details: true,
      dryRun: true,
    },
  });
  const draft: ActionDraft = {
    kind: action.kind,
    amountCents: action.amountCents,
    summary: action.summary,
    steps: action.steps as PrefilledStep[],
    details: action.details as ActionDetails,
  };

  let connector: Connector;
  try {
    connector = await usable(userId, action.connectorId, client);
    if (!connector.act || !connector.capabilities.includes("act")) {
      throw new ConnectorRefused("cant_do");
    }
    // Exactly what they said yes to: the amount, and nothing in the stored action changed since.
    if (
      action.approvedCents !== action.amountCents ||
      fingerprintOf(connector.id, draft) !== action.fingerprint
    ) {
      throw new ConnectorRefused("changed");
    }
    checkAmount(action.amountCents);
    if (!(await consentCovers(userId, connector, { client }))) {
      throw new ConnectorRefused("no_consent");
    }
    // Real money needs REAL_MONEY_MOVEMENT on top of the connector's own switch (false today).
    if (!connector.sandbox && connector.movesMoney && !mayMoveRealMoney(connector)) {
      throw new ConnectorRefused("no_real_money");
    }
    await withinDailyCaps(userId, action.amountCents, { client, now, except: actionId });
    await runGuard(connector, draft.details, { userId, client, now, actionId });
  } catch (error) {
    if (!(error instanceof ConnectorRefused)) {
      // Nothing reached the connector yet: hand the claim back, so the queue's retry (or a cancel)
      // finds it waiting rather than running forever.
      await db.connectorActions.updateMany({
        where: { id: actionId, status: "running" },
        data: { status: "approved" },
      });
      throw error;
    }
    await refuse(userId, actionId, "running", error.reason, { client, now });
    return "refused";
  }

  if (action.dryRun) {
    await db.connectorActions.updateMany({
      where: { id: actionId, status: "running" },
      data: {
        status: "succeeded",
        simulated: true,
        note: "Dry run: nothing was sent.",
        finishedAt: now,
      },
    });
    await auditStep(SYSTEM_ACTOR, "connector_action_executed", userId, {
      action: actionId,
      dry_run: true,
    });
    await track(userId, "connector_action_succeeded", { connector: connector.id, dry_run: true });
    return "succeeded";
  }

  const act = connector.act!;
  try {
    const result = await withGrant({ connectorId: connector.id, actionId, userId }, () =>
      act(draft, contextFor(userId, connector.id, actionId, now)),
    );
    const status: ConnectorStatus =
      result.state === "done"
        ? "succeeded"
        : result.state === "handed_off"
          ? "handed_off"
          : "partner_pending";
    await db.connectorActions.updateMany({
      where: { id: actionId, status: "running" },
      data: {
        status,
        externalRef: result.externalRef,
        cancelUntil: result.cancelUntil,
        note: result.note.slice(0, 500),
        ...(status === "succeeded" && { finishedAt: now }),
      },
    });
    await auditStep(SYSTEM_ACTOR, "connector_action_executed", userId, {
      connector: connector.id,
      action: actionId,
      status,
      simulated: connector.sandbox,
    });
    await track(userId, `connector_action_${status}`, { connector: connector.id });
    return status;
  } catch (error) {
    // Not retried: the partner may have acted. Its webhook, or the team, settles it.
    const reason = error instanceof NoCredential ? "no_credential" : "act_failed";
    await db.connectorActions.updateMany({
      where: { id: actionId, status: "running" },
      data: {
        status: "failed",
        reason,
        note: reason === "no_credential" ? "Connect it again, then ask again." : null,
        finishedAt: now,
      },
    });
    await auditStep(SYSTEM_ACTOR, "connector_action_failed", userId, {
      connector: connector.id,
      action: actionId,
      reason,
    });
    await track(userId, "connector_action_failed", { connector: connector.id, reason });
    return "failed";
  }
}

// What a partner's verified webhook says happened to an action (./webhooks.ts). Moves it on only
// from a status where that makes sense; a late or repeated event changes nothing.
const AFTER_EVENT: Record<
  WebhookEvent["outcome"],
  { from: ConnectorStatus[]; to: ConnectorStatus } | null
> = {
  // handed_off: the person's own last step, seen done (a manual payment in their transactions).
  done: { from: ["partner_pending", "handed_off"], to: "succeeded" },
  failed: { from: ["partner_pending"], to: "failed" },
  // Money can come back up to about 60 days after it settled (connector-plan.md).
  reversed: { from: ["partner_pending", "succeeded"], to: "reversed" },
  info: null,
};

export async function applyPartnerEvent(
  userId: string,
  actionId: string,
  event: WebhookEvent,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ConnectorStatus | null> {
  const move = AFTER_EVENT[event.outcome];
  let moved: ConnectorStatus | null = null;
  if (move) {
    const { count } = await scopedFor(userId, client).connectorActions.updateMany({
      where: { id: actionId, status: { in: move.from } },
      data: {
        status: move.to,
        note: event.note.slice(0, 500),
        ...(move.to === "failed" && { reason: "partner_failed" }),
        finishedAt: now,
      },
    });
    if (count === 1) moved = move.to;
  }
  await auditStep(SYSTEM_ACTOR, "connector_action_updated", userId, {
    action: actionId,
    outcome: event.outcome,
    moved: moved ?? "no",
  });
  if (moved) await track(userId, `connector_action_${moved}`, { via: "webhook" });
  return moved;
}

export type ActionRow = {
  id: string;
  connectorId: string;
  summary: string;
  steps: PrefilledStep[];
  amountCents: number;
  fingerprint: string;
  status: string;
  simulated: boolean;
  runAt: Date | null;
  cancelUntil: Date | null;
  note: string | null;
  createdAt: Date;
};

// The person's actions, newest first, for the connections page.
export async function listActions(
  userId: string,
  { client = defaultClient, take = 20 }: Options & { take?: number } = {},
): Promise<ActionRow[]> {
  const rows = await scopedFor(userId, client).connectorActions.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      ...PLANNED_SELECT,
      simulated: true,
      runAt: true,
      cancelUntil: true,
      note: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({ ...row, steps: row.steps as PrefilledStep[] }));
}
