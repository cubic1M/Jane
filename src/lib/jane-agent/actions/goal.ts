import { addGoal, GoalError } from "@/lib/goals";
import { ChatActionError, type ActionHandler } from "./handler";
import { centsToInput } from "@/lib/money";

// "Start a goal for it" (spec step 84), on Jane's answer to "can I afford $900 for a trip in
// March": adds the savings goal the answer named, through the goals page's own code
// (src/lib/goals.ts), so the same checks apply.

export const goalStart: ActionHandler = {
  id: "goal.start",
  on: "open",
  async run({ userId, message, action, client }) {
    const goal = message.refs.goal;
    if (!goal) throw new ChatActionError("failed", "Something went wrong. Open Goals instead.");
    try {
      await addGoal(
        userId,
        {
          name: goal.name,
          target: centsToInput(goal.targetCents),
          targetDate: goal.targetDate,
          accountId: "",
          saved: "",
        },
        { client },
      );
    } catch (error) {
      if (error instanceof GoalError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: `Added "${goal.name}" to your goals. Safe to spend now sets a little aside for it each month.`,
    };
  },
};
