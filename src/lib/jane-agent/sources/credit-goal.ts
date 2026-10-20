import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { GOAL_PAGE, doneButton } from "../credit-goal-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// A credit score for a goal (spec step 227): each month, the checklist for that month with one
// button to tick it all off, once for the month; and a heads-up when the plan has slipped
// out of reach.

export const creditGoalSource: MessageSource = {
  key: "credit_goal",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.creditGoals;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    for (const g of data.goals) {
      const todo = g.thisMonth.filter((i) => !i.done);
      if (todo.length > 0) {
        out.push({
          kind: "decision",
          body: [
            `${g.title}: this month's list (${g.currentMonth}):`,
            ...todo.map((i) => `- ${i.text}`),
            "These scores are estimates from the stand-in simulator.",
          ].join("\n"),
          refs: { advice: true, creditGoalId: g.id ?? undefined },
          actions: [doneButton(), GOAL_PAGE, snoozeButton()],
          dedupeKey: `creditgoal:${g.id}:${g.currentMonth}`,
          priority: MESSAGE_PRIORITY.credit_goal_month,
        });
      }
      if (!g.plan.reaches) {
        out.push({
          kind: "heads_up",
          body: `Your plan for ${g.targetScore} by ${g.targetDate} doesn't reach it on the simulator: the best is about ${g.plan.best}. You could move the date or lower the score on the page.`,
          refs: {},
          actions: [GOAL_PAGE],
          dedupeKey: `creditgoal_short:${g.id}:${g.plan.best}`,
          priority: MESSAGE_PRIORITY.credit_goal_short,
        });
      }
    }
    return out;
  },
};
