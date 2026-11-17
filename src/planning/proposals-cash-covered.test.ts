import { describe, expect, it } from "vitest";
import { proposals, type ProposalInput } from "./proposals";

// Debug 2, third desktop sweep (11-16, upload S7: an old Bank of America statement, $10,597.07 in
// checking): the dock offered "I could start an 'Emergency fund' goal: $4,100.00 by November
// 2027" beside the idle cash card's "about $6,529.94 is more than 3 months of spending". A goal
// to save up for a cushion is offered only while the cash is short of it, as the cushion card is.

const input = (cashCents: number | null): ProposalInput => ({
  asOf: "2026-11-16",
  suggestions: {},
  suggestionMonths: 3,
  budgetedCategories: [],
  goalNames: [],
  monthlySpendingCents: 135_571,
  cashCents,
  uncategorized: [],
});
const fund = (cashCents: number | null) =>
  proposals(input(cashCents)).find((p) => p.key === "goal:emergency_fund") ?? null;

describe("the emergency fund goal Jane offers", () => {
  it("isn't offered when the cash already covers it", () => {
    expect(fund(1_059_707)).toBeNull();
  });

  it("is offered while the cash is short of it, or not known", () => {
    expect(fund(24_390)).toMatchObject({ name: "Emergency fund", targetCents: 410_000 });
    expect(fund(null)).toMatchObject({ targetCents: 410_000 });
  });
});
