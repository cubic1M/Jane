import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { closeSettled } from "../messages";
import { MESSAGE_SELECT, toChatMessage, type ActionId, type ChatMessage } from "../types";
import { findingNo, findingPick, findingYes } from "./finding";
import { ChatActionError, linksOf, type ActionHandler } from "./handler";
import { planApproveSafe } from "./plan";
import { undoNo, undoRule } from "./undo";
import { autopilotAll, autopilotAsk, autopilotPause, autopilotSafe } from "./autopilot";
import { alertGotIt, deadlineDone, snooze } from "./heads-ups";
import { setupAll, setupNo, setupYes } from "./setup";
import { cancelDone, offerAccept, offerDecline } from "./steps";
import { goalStart } from "./goal";
import {
  investAnswer1,
  investAnswer2,
  investAnswer3,
  investAnswer4,
  investAnswer5,
} from "./investments";
import { changeBudget, changeExpected, changeLook } from "./changes";
import { lifeNever, lifeNo, lifeYes } from "./life";
import { transferCount, transferSkip, tuneUpAccept, tuneUpKeep, tuneUpUndo } from "./upkeep";

// Every button action, by id (spec step 81). A new button is a new handler here; the
// message sources offer it by id (src/lib/jane-agent/types.ts ACTION_IDS).
export const ACTION_HANDLERS: Readonly<Record<ActionId, ActionHandler>> = {
  "finding.yes": findingYes,
  "finding.no": findingNo,
  "finding.pick": findingPick,
  "plan.approve_safe": planApproveSafe,
  "undo.rule": undoRule,
  "undo.no": undoNo,
  // Spec step 83.
  "autopilot.safe": autopilotSafe,
  "autopilot.all": autopilotAll,
  "autopilot.ask": autopilotAsk,
  "setup.yes": setupYes,
  "setup.no": setupNo,
  "setup.all": setupAll,
  "offer.accept": offerAccept,
  "offer.decline": offerDecline,
  "cancel.done": cancelDone,
  "deadline.done": deadlineDone,
  "alert.got_it": alertGotIt,
  snooze: snooze,
  // Typing to Jane (spec step 84).
  "goal.start": goalStart,
  "autopilot.pause": autopilotPause,
  // Investments (spec step 129 on).
  "invest.answer.1": investAnswer1,
  "invest.answer.2": investAnswer2,
  "invest.answer.3": investAnswer3,
  "invest.answer.4": investAnswer4,
  "invest.answer.5": investAnswer5,
  // Jane notices changes (spec step 97).
  "change.look": changeLook,
  "change.budget": changeBudget,
  "change.expected": changeExpected,
  // Life events spotted (spec step 100).
  "life.yes": lifeYes,
  "life.no": lifeNo,
  "life.never": lifeNever,
  // Plans that keep up (spec step 101).
  "tuneup.accept": tuneUpAccept,
  "tuneup.keep": tuneUpKeep,
  "tuneup.undo": tuneUpUndo,
  "transfer.count": transferCount,
  "transfer.skip": transferSkip,
};

const MESSAGE_ID = /^[a-z0-9]{1,40}$/i;

type Options = { client?: PrismaClient; now?: Date };

// A tap on a button. Checked here, whatever the page sent: the message is the person's
// own, the button is one it offers, and the message is in the state the button works on
// (still open, or within Undo's time). Returns the message as it is now.
export async function takeChatAction(
  userId: string,
  messageId: string,
  actionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{
  message: ChatMessage;
  agentJobIds: (string | undefined)[];
  agentActionIds: string[];
}> {
  const db = scopedFor(userId, client);
  const row = MESSAGE_ID.test(messageId)
    ? await db.janeMessages.findFirst({ where: { id: messageId }, select: MESSAGE_SELECT })
    : null;
  if (!row) throw new ChatActionError("not_found", "That message isn't there anymore.");
  const message = toChatMessage(row);
  const handler = Object.hasOwn(ACTION_HANDLERS, actionId)
    ? ACTION_HANDLERS[actionId as ActionId]
    : undefined;
  if (handler && message.status !== handler.on) {
    throw new ChatActionError("not_open", "This one's already been answered.");
  }
  const action = message.actions.find((a) => a.id === actionId && a.kind !== "link");
  if (!action || !handler) {
    throw new ChatActionError("not_offered", "That button isn't on this message.");
  }
  const { undoUntil } = message.refs;
  if (actionId.startsWith("undo.") && undoUntil && new Date(undoUntil) <= now) {
    throw new ChatActionError("expired", "It's too late to undo this one.");
  }

  const outcome = await handler.run({ userId, message, action, client, now });
  const status = outcome.status ?? "answered";
  const refs = { ...(outcome.refs ?? message.refs) };
  if (outcome.note) refs.note = outcome.note;
  // Only if no other tap changed it meanwhile.
  await db.janeMessages.updateMany({
    where: { id: message.id, status: message.status },
    data: {
      status,
      answeredWith: outcome.answeredWith,
      answeredAt: status === "open" ? null : now,
      refs: refs as Prisma.InputJsonObject,
      actions: (outcome.actions ?? linksOf(message.actions)) as Prisma.InputJsonArray,
      // Spec step 83: "Not now" hides it until then; any other answer clears that.
      snoozedUntil: outcome.snoozedUntil ?? null,
    },
  });
  // Other messages this settled (a finding approved with the whole plan) lose their buttons.
  await closeSettled(userId, { client, now });

  await logAudit(
    { type: "user", id: userId },
    "chat_action_taken",
    { type: "jane_message", id: message.id },
    { action: actionId, kind: message.kind },
  );
  await track(userId, "chat_action_taken", { action: actionId, kind: message.kind });

  const updated = await db.janeMessages.findFirst({
    where: { id: message.id },
    select: MESSAGE_SELECT,
  });
  return {
    message: updated ? toChatMessage(updated) : message,
    agentJobIds: outcome.agentJobIds ?? [],
    agentActionIds: outcome.agentActionIds ?? [],
  };
}

export { ChatActionError } from "./handler";
