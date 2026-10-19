import { BudgetError, setBudget } from "@/lib/budgets";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// "Set a budget" (spec step 90), on Jane's answers about a category with no budget yet,
// prefilled with what the person usually spends there: set through Budgets' own code
// (src/lib/budgets.ts), so the same checks apply.

export const budgetSet: ActionHandler = {
  id: "budget.set",
  on: "open",
  async run({ userId, message, action, client }) {
    const budget = message.refs.budget;
    if (!budget) throw new ChatActionError("failed", "Something went wrong. Open Budgets instead.");
    try {
      await setBudget(userId, budget.category, (budget.amountCents / 100).toFixed(2), { client });
    } catch (error) {
      if (error instanceof BudgetError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    return {
      answeredWith: action.label,
      note: `Done. Your ${budget.category} budget is ${formatCents(budget.amountCents)} a month, starting this month. I'll tell you here if you get close to it.`,
    };
  },
};
