import { MultiYearError, putMoveOnPlan } from "@/lib/multi-year";
import { ChatActionError, type ActionHandler } from "./handler";

// A multi-year tax move put on the person's deadlines (spec step 220): demo advice, and a
// reminder only; carrying it out is the person's (or the investing side's, with their tap).
export const taxYearsPlan: ActionHandler = {
  id: "tax.years_plan",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const key = message.refs.yearsMove;
    if (!key) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    try {
      const move = await putMoveOnPlan(userId, key, { client, now, via: "chat" });
      return {
        answeredWith: action.label,
        note: `Done: "${move.title}" is on your deadlines. I move no money; carrying it out is yours.`,
      };
    } catch (error) {
      if (error instanceof MultiYearError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
};
