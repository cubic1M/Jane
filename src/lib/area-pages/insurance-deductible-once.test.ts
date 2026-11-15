import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";

// Debugger 11-15: a demo-bank student's Insurance tree said "Deductible, Could be $2k" under
// Your perfect coverage and "Raise the deductible, $170/yr" under Pay less for the same cover,
// both about their GEICO car policy: one piece of advice, two places, two different amounts.
// While the saving is offered it says it, once, with its price and its "Raise it".

const raiseNeed = (policyId: string) => ({
  kind: "deductible",
  policyId,
  gapCents: 150_000,
  haveCents: 50_000,
  needCents: 200_000,
  unit: "total" as const,
  direction: "raise" as const,
  summary: "",
  opened: false,
});

const raiseSaving = (policyId: string) => ({
  id: "s1",
  policyId,
  kind: "higher_deductible" as const,
  yearlySavingCents: 17_040,
  line: "Raise your GEICO car deductible from $500 to $1,000: about $170.40 a year less",
});

const input = (over: Partial<InsuranceTreeInput>): InsuranceTreeInput =>
  ({
    asOf: "2026-11-15",
    needs: [],
    policies: [],
    gaps: [],
    savings: [],
    renewals: [],
    changes: [],
    readings: [],
    payingTwice: [],
    cards: [],
    household: [],
    risks: [],
    health: null,
    ...over,
  }) as InsuranceTreeInput;

const deductibleItems = (over: Partial<InsuranceTreeInput>) =>
  insuranceTree(input(over))
    .tree.branches.flatMap((b) => b.items)
    .filter((i) => /deductible/i.test(i.label))
    .map((i) => i.id);

describe("raising a deductible on the insurance tree", () => {
  it("is said once, as the saving, when the saving is offered for that policy", () => {
    expect(deductibleItems({ needs: [raiseNeed("p1")], savings: [raiseSaving("p1")] })).toEqual([
      "savings:s1",
    ]);
  });

  it("stays a need when no saving is offered for that policy", () => {
    expect(deductibleItems({ needs: [raiseNeed("p1")], savings: [raiseSaving("p2")] })).toEqual([
      "needs:deductible-p1",
      "savings:s1",
    ]);
    expect(deductibleItems({ needs: [raiseNeed("p1")] })).toEqual(["needs:deductible-p1"]);
  });
});
