import { BnplError, payOffPlan } from "@/lib/bnpl";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Paying a buy now, pay later plan off early from the chat (spec step 176), through the
// money-movement stand-in, only on the person's tap.
export const bnplPayoff: ActionHandler = {
  id: "bnpl.payoff",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.bnplPlan;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open your debts instead.");
    try {
      const paid = await payOffPlan(userId, target.key, { client, now });
      return {
        answeredWith: action.label,
        note: `Scheduled: ${formatCents(paid.amountCents)} to pay off the ${paid.name}. That clears the rest of its installments.`,
      };
    } catch (error) {
      throw error instanceof BnplError ? new ChatActionError("failed", error.message) : error;
    }
  },
};
