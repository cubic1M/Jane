import { dayLabel } from "@/lib/day-label";
import { HomeBuyingError, startHomeGoal } from "@/lib/home-buying";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Starting the down payment goal from the chat (spec step 179): a savings goal for the cash
// needed by a date, only on the person's tap. Step 157 then invests it for its timeline.
export const homeGoal: ActionHandler = {
  id: "home.goal",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.homeGoal;
    if (!target) {
      throw new ChatActionError("failed", "Something went wrong. Open the home plan instead.");
    }
    try {
      const goal = await startHomeGoal(userId, { priceCents: target.priceCents }, { client, now });
      return {
        answeredWith: action.label,
        note: `Started: ${formatCents(goal.targetCents)} by ${dayLabel(goal.targetDate, { year: true })}. It's on your goals page, and I'll invest it for its timeline.`,
      };
    } catch (error) {
      throw error instanceof HomeBuyingError ? new ChatActionError("failed", error.message) : error;
    }
  },
};
