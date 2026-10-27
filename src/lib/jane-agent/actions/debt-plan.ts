import { DebtPlanError, startDebtPlan } from "@/lib/debt-plan";
import { formatCents } from "@/lib/money";

import type { Strategy } from "@/planning/debt";
import { ChatActionError, type ActionHandler } from "./handler";
import { monthLabel } from "@/lib/day-label";

// "Start this plan" on Jane's payoff plan (spec step 110): saves the order and the extra a
// month through the plan's own code (src/lib/debt-plan.ts). Nothing is paid or moved: Jane
// keeps the plan current and checks it every month.

const start = (strategy: Strategy): ActionHandler => ({
  id: strategy === "avalanche" ? "debt_plan.avalanche" : "debt_plan.snowball",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const extraCents = message.refs.debtPlanExtraCents ?? 0;
    try {
      const plan = await startDebtPlan(userId, { strategy, extraCents }, { client, now });
      const when = plan.debtFreeMonth
        ? `, debt-free by ${monthLabel(plan.debtFreeMonth, { long: true })}`
        : "";
      const extra = extraCents > 0 ? ` with ${formatCents(extraCents)} extra a month` : "";
      return {
        answeredWith: action.label,
        note: `Started${extra}${when}. I'll check it every month and tell you if you fall behind.`,
      };
    } catch (error) {
      if (error instanceof DebtPlanError) throw new ChatActionError("failed", error.message);
      throw error;
    }
  },
});

export const debtPlanAvalanche = start("avalanche");
export const debtPlanSnowball = start("snowball");
