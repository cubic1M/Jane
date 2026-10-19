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
// Actions), a deadline marked done on Deadlines and an alert read on Alerts. Their links
// stay.

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
  const anyAutopilot = open.some(asksAutopilot);
  const anyProposal = open.some((m) => m.refs.proposalKey);
  if (!anyAutopilot && !anyProposal && !actionIds.length && !deadlineIds.length && !alertIds.length)
    return 0;

  const [autopilot, proposals, actions, deadlines, alerts] = await Promise.all([
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
      ? db.alerts.findMany({ where: { id: { in: alertIds }, readAt: null }, select: { id: true } })
      : [],
  ]);
  const openProposalKeys = new Set(proposals.map((p) => p.key));
  const stepNow = new Map(actions.map((a) => [a.id, stepOf(a)]));
  const openDeadlines = new Set(deadlines.map((d) => d.id));
  const unreadAlerts = new Set(alerts.map((a) => a.id));

  const settled = (m: Open) => {
    const { proposalKey, step, actionId, deadlineEntryId, alertId } = m.refs;
    return (
      (asksAutopilot(m) && autopilot !== null) ||
      (proposalKey !== undefined && !openProposalKeys.has(proposalKey)) ||
      (step !== undefined && actionId !== undefined && stepNow.get(actionId) !== step) ||
      (deadlineEntryId !== undefined && !openDeadlines.has(deadlineEntryId)) ||
      (alertId !== undefined && !unreadAlerts.has(alertId))
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
