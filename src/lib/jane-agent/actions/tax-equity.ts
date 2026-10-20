import { EquityTaxError, startSetAside } from "@/lib/equity-tax";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { ChatActionError, type ActionHandler } from "./handler";

// A goal for the tax crypto and equity pay will bring (spec step 219): demo advice, and a
// tracker only; putting money in is the person's own.
export const taxEquityAside: ActionHandler = {
  id: "tax.equity_aside",
  on: "open",
  async run({ userId, action, client, now }) {
    try {
      const aside = await startSetAside(userId, { client, now, via: "chat" });
      return {
        answeredWith: action.label,
        note: `Done: "${aside.goalName}" is a goal for ${roundDollars(aside.cents)}. Putting money in is yours.`,
      };
    } catch (error) {
      if (error instanceof EquityTaxError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};
