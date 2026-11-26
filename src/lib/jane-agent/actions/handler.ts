import type { PrismaClient } from "@/generated/prisma/client";
import { BRING_BACK_LABEL, PUT_AWAY_UNDO_MINUTES } from "@/config/put-away";
import type { ActionId, ChatMessage, MessageAction, MessageRefs, MessageStatus } from "../types";

// A button action (spec step 81): what one button on one of Jane's messages does. Each
// works through the code the rest of the app uses (decisions, the plan, standing rules),
// never a shortcut of its own. The registry is ./index.ts.

export type ActionContext = {
  userId: string;
  message: ChatMessage;
  // The button as it was offered.
  action: MessageAction;
  // What was chosen with it, for a button that carries a choice (option.pick: the option's
  // id). Checked by the handler against what the message offered.
  choice?: string;
  // The showing of a guided flow's question the button was drawn with (refs.flow.shown), when the
  // page sent it.
  flowShown?: string;
  client: PrismaClient;
  now: Date;
};

export type ActionOutcome = {
  // "answered" unless said otherwise (an undone No opens the message again).
  status?: MessageStatus;
  // Spec step 118: a guided question moves on to the next one in the same message.
  body?: string;
  // What the person chose, shown in place of the buttons; null clears it.
  answeredWith: string | null;
  // One line on what happened.
  note?: string;
  // Replaces the message's refs when given.
  refs?: MessageRefs;
  // The buttons left on the message. By default only its links (Open) stay.
  actions?: MessageAction[];
  // The agent's first jobs, for the caller to run after the response.
  agentJobIds?: (string | undefined)[];
  // Spec step 83: "Not now" hides the message from the chat until then.
  snoozedUntil?: Date;
  // Spec step 83: actions whose queued agent steps to run after the response (what a new
  // autopilot level approved at once, like Settings does).
  agentActionIds?: string[];
  // Spec step 88: the tap posted a new message (an answer), so the chat should reload.
  posted?: boolean;
};

export type ActionHandler = {
  id: ActionId;
  // The message status this button works on: most need an open message; Undo after a No
  // works on the answered one, and bringing back a card put away on whichever it left.
  on: MessageStatus | readonly MessageStatus[];
  run(context: ActionContext): Promise<ActionOutcome>;
};

export type ChatActionErrorCode = "not_found" | "not_offered" | "not_open" | "expired" | "failed";

export class ChatActionError extends Error {
  constructor(
    readonly code: ChatActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const linksOf = (actions: MessageAction[]) => actions.filter((a) => a.kind === "link");

// A message put away (Not now, "Don't suggest this again") keeps the way back: its buttons, and
// the one that brings it back as it was, for PUT_AWAY_UNDO_MINUTES (founder, 11-16).
export function putAwayUndo(
  message: ChatMessage,
  undo: "undo.snooze" | "undo.never" | "undo.suggest_never",
  now: Date,
  refs: Partial<MessageRefs> = {},
): Pick<ActionOutcome, "refs" | "actions"> {
  return {
    refs: {
      ...message.refs,
      ...refs,
      previousActions: message.actions,
      undoUntil: new Date(now.getTime() + PUT_AWAY_UNDO_MINUTES * 60_000).toISOString(),
    },
    actions: [
      { id: undo, label: BRING_BACK_LABEL, kind: "secondary" },
      ...linksOf(message.actions),
    ],
  };
}

// Spec step 83: what a feature's own check says when the thing was already answered on its
// page (or changed since the message), as a refusal that changes nothing.
export const answeredElsewhere = (message: string) => new ChatActionError("not_open", message);
