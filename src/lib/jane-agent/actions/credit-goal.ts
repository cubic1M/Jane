import { CreditGoalError, completeGoalItems, startCreditGoal } from "@/lib/credit-goals";
import { ChatActionError, type ActionHandler } from "./handler";

// Starting a credit score plan and ticking off a month's list, from the chat (spec step 227),
// each only on the person's tap.

const failed = (error: unknown) =>
  error instanceof CreditGoalError ? new ChatActionError("failed", error.message) : error;

export const creditGoalStart: ActionHandler = {
  id: "creditgoal.start",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const draft = message.refs.creditGoalDraft;
    if (!draft)
      throw new ChatActionError("failed", "Something went wrong. Open your credit plan instead.");
    try {
      const goal = await startCreditGoal(userId, draft, { client, now });
      return {
        answeredWith: action.label,
        note: `Started: ${goal.title}. Each month I'll bring up that month's list, and you tick it off here or on your credit plan page.`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const creditGoalDone: ActionHandler = {
  id: "creditgoal.done",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.creditGoalId;
    if (!id)
      throw new ChatActionError("failed", "Something went wrong. Open your credit plan instead.");
    try {
      const n = await completeGoalItems(userId, id, "all", { client, now });
      return {
        answeredWith: action.label,
        note: `Ticked off ${n} ${n === 1 ? "item" : "items"} for this month.`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};
