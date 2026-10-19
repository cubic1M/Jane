import type { PrismaClient } from "@/generated/prisma/client";
import type { ActionId, ChatMessage, MessageAction, MessageRefs, MessageStatus } from "../types";

// A button action (spec step 81): what one button on one of Jane's messages does. Each
// works through the code the rest of the app uses (decisions, the plan, standing rules),
// never a shortcut of its own. The registry is ./index.ts.

export type ActionContext = {
  userId: string;
  message: ChatMessage;
  // The button as it was offered.
  action: MessageAction;
  client: PrismaClient;
  now: Date;
};

export type ActionOutcome = {
  // "answered" unless said otherwise (an undone No opens the message again).
  status?: MessageStatus;
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
};

export type ActionHandler = {
  id: ActionId;
  // The message status this button works on: most need an open message; Undo after a No
  // works on the answered one.
  on: MessageStatus;
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
