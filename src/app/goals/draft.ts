import { centsToInput } from "@/lib/money";
import type { GoalProposal, Proposal } from "@/planning/proposals";

// A goal form drafted from one of Jane's goal proposals, named in the address by its kind only
// ("/goals?draft=emergency_fund"), never by an amount (#1807: nothing personal in addresses).
// Debug 2, 11-16: Yes on "Build an emergency cushion" opened an empty form.

export type GoalFormValues = {
  goalId: string;
  name: string;
  target: string;
  targetDate: string;
  accountId: string;
  saved: string;
};

export const EMPTY_GOAL: GoalFormValues = {
  goalId: "",
  name: "",
  target: "",
  targetDate: "",
  accountId: "",
  saved: "",
};

export function draftedGoal(proposals: readonly Proposal[], draft: unknown): GoalFormValues {
  if (typeof draft !== "string" || !/^[a-z_]+$/.test(draft)) return EMPTY_GOAL;
  const goal = proposals.find(
    (p): p is GoalProposal => p.kind === "goal" && p.key === `goal:${draft}`,
  );
  if (!goal) return EMPTY_GOAL;
  return {
    ...EMPTY_GOAL,
    name: goal.name,
    target: centsToInput(goal.targetCents),
    targetDate: goal.targetDate,
  };
}
