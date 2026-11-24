import { describe, expect, it } from "vitest";
import { leanMessage, leanPlan } from "./lean-plan";

// CodeRabbit sweep 1b: an account with no balance made "cash covers 0 months".
const input = {
  monthlySpendingCents: 300_000,
  forecastBillsCents: 200_000,
  waitable: [],
  debts: [],
  stateName: null,
};

describe("the lean plan's runway", () => {
  it("is unknown when cash is unknown, and 0 months for a known zero", () => {
    const unknown = leanPlan({ ...input, cashCents: null });
    expect(unknown.runwayMonths).toBeNull();
    expect(leanMessage(unknown)).toMatch(/can't work out how long your cash lasts/);
    expect(leanPlan({ ...input, cashCents: 0 }).runwayMonths).toBe(0);
  });
});
