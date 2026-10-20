import { TaxCalendarError, payEstimate } from "@/lib/tax-calendar";
import { addOpenPlanMoves } from "@/lib/tax-plan";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// The tax calendar from the chat (spec step 223): pay an estimated payment through the
// stand-in on the person's tap, and put December's open moves on their deadlines.

export const taxEstimatePay: ActionHandler = {
  id: "tax.estimate_pay",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const dueOn = message.refs.estimateDue;
    if (!dueOn) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    try {
      const r = await payEstimate(userId, dueOn, { client, now, via: "tap" });
      return {
        answeredWith: action.label,
        note: `Done: ${formatCents(r.cents)} paid (confirmation ${r.confirmation}). This is the practice payment: no real money moved.`,
      };
    } catch (error) {
      if (error instanceof TaxCalendarError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};

export const taxYearEndPlan: ActionHandler = {
  id: "tax.yearend_plan",
  on: "open",
  async run({ userId, action, client, now }) {
    const added = await addOpenPlanMoves(userId, { client, now });
    return {
      answeredWith: action.label,
      note:
        added.length > 0
          ? `Done: ${added.length} ${added.length === 1 ? "move is" : "moves are"} on your deadlines.`
          : "They were already on your deadlines.",
    };
  },
};
