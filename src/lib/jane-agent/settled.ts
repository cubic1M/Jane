import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { autopilotOf } from "@/lib/autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { openProposals } from "@/lib/proposals";
import { stepOf } from "./agent-steps";
import { parseActions, parseRefs, type MessageAction, type MessageRefs } from "./types";

// Messages answered somewhere else lose their buttons (spec step 83, like findings in step
// 81): the autopilot question once a level is picked in Settings, a set-up suggestion
// answered on the plan, a step on an action that's no longer waiting on it (answered on
// Actions), a deadline marked done on Deadlines, an alert read on Alerts and a policy
// reading confirmed on Insurance (spec step 151). Their links stay.

type Open = { id: string; refs: MessageRefs; actions: MessageAction[] };

// The autopilot question's own buttons (not step 84's "Pause autopilot", which works on
// a level already picked).
const QUESTION_IDS: readonly string[] = ["autopilot.safe", "autopilot.all", "autopilot.ask"];
const asksAutopilot = (m: Open) => m.actions.some((a) => QUESTION_IDS.includes(a.id));

export async function closeAnsweredElsewhere(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const open: Open[] = (
    await db.janeMessages.findMany({
      where: { status: "open" },
      select: { id: true, refs: true, actions: true },
    })
  ).map((m) => ({ id: m.id, refs: parseRefs(m.refs), actions: parseActions(m.actions) }));
  const ids = (pick: (m: Open) => string | undefined) =>
    open.flatMap((m) => {
      const id = pick(m);
      return id ? [id] : [];
    });
  const actionIds = ids((m) => (m.refs.step ? m.refs.actionId : undefined));
  const deadlineIds = ids((m) => m.refs.deadlineEntryId);
  const alertIds = ids((m) => m.refs.alertId);
  const readingIds = ids((m) => m.refs.readingId);
  const coverRefs = ids((m) => m.refs.coverEvent);
  const negotiationIds = ids((m) => m.refs.negotiationId);
  const anySaving = open.some((m) => m.refs.savingGroup || m.refs.savingId);
  const anyAutopilot = open.some(asksAutopilot);
  const anyProposal = open.some((m) => m.refs.proposalKey);
  if (
    !anyAutopilot &&
    !anyProposal &&
    !actionIds.length &&
    !deadlineIds.length &&
    !alertIds.length &&
    !readingIds.length &&
    !coverRefs.length &&
    !negotiationIds.length &&
    !anySaving
  )
    return 0;

  const [autopilot, proposals, actions, deadlines, alerts, readings, covers, asked] =
    await Promise.all([
      anyAutopilot ? autopilotOf(userId, { client }) : null,
      anyProposal ? openProposals(userId, { client }) : [],
      actionIds.length
        ? db.actions.findMany({
            where: { id: { in: actionIds } },
            select: { id: true, status: true, agentState: true, type: true, selfServiceUrl: true },
          })
        : [],
      deadlineIds.length
        ? db.deadlines.findMany({
            where: { id: { in: deadlineIds }, doneAt: null },
            select: { id: true },
          })
        : [],
      alertIds.length
        ? db.alerts.findMany({
            where: { id: { in: alertIds }, readAt: null },
            select: { id: true },
          })
        : [],
      readingIds.length
        ? db.policyReadings.findMany({
            where: { id: { in: readingIds }, status: "waiting" },
            select: { id: true },
          })
        : [],
      coverRefs.length
        ? db.coverChanges.findMany({
            where: { status: "prepared" },
            select: { event: true, eventKey: true },
          })
        : [],
      negotiationIds.length
        ? db.renewalNegotiations.findMany({
            where: { id: { in: negotiationIds }, status: "asked" },
            select: { id: true },
          })
        : [],
    ]);
  // Spec step 196: savings still offered; one applied or dismissed elsewhere closes its message.
  const offers = anySaving
    ? await db.insuranceSavings.findMany({
        where: { status: "offered" },
        select: { id: true, kind: true },
      })
    : [];
  const offeredIds = new Set(offers.map((o) => o.id));
  const sameOffered = offers.some((o) => o.kind !== "higher_deductible");
  const openProposalKeys = new Set(proposals.map((p) => p.key));
  const stepNow = new Map(actions.map((a) => [a.id, stepOf(a)]));
  const openDeadlines = new Set(deadlines.map((d) => d.id));
  const unreadAlerts = new Set(alerts.map((a) => a.id));
  const waitingReadings = new Set(readings.map((r) => r.id));
  const preparedCovers = new Set(covers.map((c) => `${c.event}|${c.eventKey}`));
  const stillAsked = new Set(asked.map((n) => n.id));

  const settled = (m: Open) => {
    const {
      proposalKey,
      step,
      actionId,
      deadlineEntryId,
      alertId,
      readingId,
      coverEvent,
      negotiationId,
      savingGroup,
      savingId,
    } = m.refs;
    return (
      (asksAutopilot(m) && autopilot !== null) ||
      (proposalKey !== undefined && !openProposalKeys.has(proposalKey)) ||
      (step !== undefined && actionId !== undefined && stepNow.get(actionId) !== step) ||
      (deadlineEntryId !== undefined && !openDeadlines.has(deadlineEntryId)) ||
      (alertId !== undefined && !unreadAlerts.has(alertId)) ||
      (readingId !== undefined && !waitingReadings.has(readingId)) ||
      (coverEvent !== undefined && !preparedCovers.has(coverEvent)) ||
      (negotiationId !== undefined && !stillAsked.has(negotiationId)) ||
      (savingId !== undefined && !offeredIds.has(savingId)) ||
      (savingGroup !== undefined && !sameOffered)
    );
  };

  let closed = 0;
  for (const message of open.filter(settled)) {
    const { count } = await db.janeMessages.updateMany({
      where: { id: message.id, status: "open" },
      data: {
        status: "answered",
        answeredAt: now,
        actions: message.actions.filter((a) => a.kind === "link") as Prisma.InputJsonArray,
      },
    });
    closed += count;
  }
  return closed;
}
