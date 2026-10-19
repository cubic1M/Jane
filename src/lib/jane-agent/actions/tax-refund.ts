import { RefundError, applyRefundPlan, dismissRefund } from "@/lib/tax-refund";
import { ChatActionError, type ActionHandler } from "./handler";

// A tax refund's plan from the chat (spec step 125), through src/lib/tax-refund.ts: "Set it
// up" adds the goals and reminders; "Not this time" leaves it. Nothing moves money.

export const taxRefundApply: ActionHandler = {
  id: "tax.refund_apply",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.taxRefund;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    try {
      const { reminders } = await applyRefundPlan(userId, id, { client, now, via: "chat" });
      return {
        answeredWith: action.label,
        note: `Done: ${reminders} ${reminders === 1 ? "reminder is" : "reminders are"} on your deadlines. Move the money when you're ready.`,
      };
    } catch (error) {
      if (error instanceof RefundError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};

export const taxRefundNo: ActionHandler = {
  id: "tax.refund_no",
  on: "open",
  async run({ userId, message, action, client }) {
    const id = message.refs.taxRefund;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    await dismissRefund(userId, id, { client, via: "chat" });
    return { answeredWith: action.label, note: "OK. It's yours to use as you like." };
  },
};
