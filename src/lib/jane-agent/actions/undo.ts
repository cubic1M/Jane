import { DecisionError, undoDecision } from "@/lib/decisions";
import { undoRuleApproval } from "@/lib/standing-rules";
import { UNDO_NEVER, UNDO_SNOOZE } from "@/config/put-away";
import { asSnapshot, takeBackNo } from "@/lib/suggestion-take-back";
import type { ChatMessage } from "../types";
import type { MessageRefs } from "../types";
import { ChatActionError, type ActionHandler } from "./handler";

// Undo (spec step 81), through the app's own undo functions and their time limits: a yes a
// standing rule gave, within a day and before the work starts; a No, for a few seconds.

const cannot = (error: unknown): never => {
  if (error instanceof DecisionError) throw new ChatActionError("expired", error.message);
  throw error;
};

export const undoRule: ActionHandler = {
  id: "undo.rule",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const { decisionId } = message.refs;
    if (!decisionId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    await undoRuleApproval(userId, decisionId, { client, now }).catch(cannot);
    return { answeredWith: action.label, note: "Taken back. It's on your plan again." };
  },
};

// Brings the message back as it was, buttons and all.
export const undoNo: ActionHandler = {
  id: "undo.no",
  on: "answered",
  async run({ userId, message, client, now }) {
    const { decisionId, previousActions, ...rest } = message.refs;
    if (!decisionId) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    await undoDecision(userId, decisionId, { client, now }).catch(cannot);
    const refs: MessageRefs = { ...rest };
    delete refs.undoUntil;
    delete refs.note;
    return { status: "open", answeredWith: null, refs, actions: previousActions ?? [] };
  },
};

// A card put away, brought back from the line left in its place (founder, 11-16): open again with
// its buttons, as if it had never gone. What the putting away kept is dropped.
function reopened(message: ChatMessage) {
  const { previousActions, ...rest } = message.refs;
  const refs: MessageRefs = { ...rest };
  delete refs.undoUntil;
  delete refs.note;
  delete refs.undoNo;
  return { status: "open" as const, answeredWith: null, refs, actions: previousActions ?? [] };
}

// Not now: it was only hidden until tomorrow.
export const undoSnooze: ActionHandler = {
  id: UNDO_SNOOZE,
  on: "dismissed",
  async run({ message }) {
    return reopened(message);
  },
};

// "Don't suggest this again": the suggestion, its savings record and the habit it counted toward
// go back to what they were.
export const undoNever: ActionHandler = {
  id: UNDO_NEVER,
  on: "answered",
  async run({ userId, message, client, now }) {
    const before = asSnapshot(message.refs.undoNo);
    if (!before) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
    await takeBackNo(userId, before, { client, now });
    return reopened(message);
  },
};
