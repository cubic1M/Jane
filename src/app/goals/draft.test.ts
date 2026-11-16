import { describe, expect, it } from "vitest";
import type { Proposal } from "@/planning/proposals";
import { EMPTY_GOAL, draftedGoal } from "./draft";

// Debug 2 (11-16): the goal form a suggestion's Yes opens is drafted from Jane's own proposal,
// the same sizing as the cushion card; anything else in the address leaves it empty.

const proposals: Proposal[] = [
  { kind: "budget", key: "budget:Food and drink", category: "Food and drink", amountCents: 16_000 },
  {
    kind: "goal",
    key: "goal:emergency_fund",
    name: "Emergency fund",
    targetCents: 660_000,
    targetDate: "2027-11-16",
    monthlySpendingCents: 217_494,
  },
];

describe("a drafted goal form", () => {
  it("fills in the emergency fund Jane proposed", () => {
    expect(draftedGoal(proposals, "emergency_fund")).toEqual({
      ...EMPTY_GOAL,
      name: "Emergency fund",
      target: "6600.00",
      targetDate: "2027-11-16",
    });
  });

  it("stays empty for a draft Jane hasn't proposed, or anything else", () => {
    expect(draftedGoal(proposals, "yearly_bills")).toEqual(EMPTY_GOAL);
    expect(draftedGoal(proposals, ["emergency_fund"])).toEqual(EMPTY_GOAL);
    expect(draftedGoal(proposals, "../x")).toEqual(EMPTY_GOAL);
  });
});
