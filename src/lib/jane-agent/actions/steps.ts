import { AnswerError, markSelfCancelled } from "@/lib/agent/run";
import { answerOffer } from "@/lib/voice/calls";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// The steps only the person can do, from the chat (spec step 83), through the same code as
// the actions page, which checks the action is still waiting on exactly that: Accept or
// Decline an offer made on a call (answerOffer: accepting goes to the team to put in
// place; nothing is accepted on a call without this tap), and "I've cancelled" after
// cancelling on the company's own page (markSelfCancelled: Jane then watches for the next
// charge).

async function onAction(
  context: ActionContext,
  step: string,
  act: (actionId: string) => Promise<void>,
) {
  const { actionId, step: offered } = context.message.refs;
  if (!actionId || offered !== step) {
    throw new ChatActionError("failed", "Something went wrong. Open Actions instead.");
  }
  try {
    await act(actionId);
  } catch (error) {
    if (error instanceof AnswerError) throw answeredElsewhere(error.message);
    throw error;
  }
}

function offer(accept: boolean): ActionHandler {
  return {
    id: accept ? "offer.accept" : "offer.decline",
    on: "open",
    async run(context) {
      const { userId, client, now } = context;
      await onAction(context, "offer", (actionId) =>
        answerOffer(userId, actionId, accept, { client, now }),
      );
      return {
        answeredWith: context.action.label,
        note: accept
          ? "Accepted. Our team will put it in place with the provider and confirm."
          : "Declined. Nothing changes with your bill.",
      };
    },
  };
}

export const offerAccept = offer(true);
export const offerDecline = offer(false);

export const cancelDone: ActionHandler = {
  id: "cancel.done",
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    await onAction(context, "self_cancel", (actionId) =>
      markSelfCancelled(userId, actionId, { client, now }),
    );
    return {
      answeredWith: context.action.label,
      note: "Thanks. I'll watch for the next charge to make sure.",
    };
  },
};
