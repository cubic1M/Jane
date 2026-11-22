import { EMERGENCY_FUND_ROUNDING_CENTS } from "@/config/proposals";
import { type Cushion, cushionWhy } from "@/detectors/money";
import { addMonths } from "@/lib/dates";
import { centsToInput, formatCents } from "@/lib/money";
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

// The cushion card's goal ("Build an emergency cushion, protect $X"): Jane's proposal when there
// is one, else the cushion itself rounded up as the proposal rounds it, and the line the page says
// above the form, the card's figure with its working and what the form holds (debug 2, 11-22: the
// form held "$5,400 by Nov 2027" or nothing, and the card's $3,875 was nowhere on the page).
export function cushionDraft(
  cushion: Cushion,
  proposed: GoalFormValues,
  asOf: string,
): { values: GoalFormValues; line: string } {
  const rounded =
    Math.ceil(cushion.target.targetCents / EMERGENCY_FUND_ROUNDING_CENTS) *
    EMERGENCY_FUND_ROUNDING_CENTS;
  const values = proposed.target
    ? proposed
    : {
        ...EMPTY_GOAL,
        name: cushion.target.name,
        target: centsToInput(rounded),
        targetDate: addMonths(asOf, cushion.target.targetMonths),
      };
  const held = values.target === centsToInput(rounded);
  const form =
    held && rounded !== cushion.target.targetCents
      ? ` The goal below is ${formatCents(cushion.target.targetCents)}, rounded up to ${formatCents(rounded)}.`
      : held
        ? ""
        : ` The goal below is Jane's proposal, ${formatCents(Math.round(Number(values.target) * 100))}.`;
  return {
    values,
    line: `${formatCents(cushion.short)} short of a cushion. ${cushionWhy(cushion)}${form}`,
  };
}
