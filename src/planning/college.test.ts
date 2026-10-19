import { describe, expect, it } from "vitest";
import { PLANS_529 } from "@/config/college";
import {
  collegeCost,
  collegeGoal,
  comparePlans,
  costRange,
  monthlyRange,
  monthlyToReach,
  stateBenefit,
  stateRate,
  yearsUntilCollege,
} from "./college";

// Spec step 158: amounts are ranges, never promises; the state benefit uses the tax
// profile's state.

const home = PLANS_529.find((p) => p.homeState)!;
const national = PLANS_529.find((p) => p.key === "national")!;

describe("what college could cost", () => {
  it("grows four years of today's price to when the child starts", () => {
    // $24,920 a year, 13 years away, growing 3%: the sum of 24,920 × 1.03^13…16.
    expect(collegeCost("public", 13, 0.03)).toBe(15_310_343);
    expect(costRange("public", 5)).toEqual({ lowCents: 15_310_343, highCents: expect.any(Number) });
    const r = costRange("private", 5);
    expect(r.lowCents).toBeLessThan(r.highCents);
    expect(yearsUntilCollege(17)).toBe(1);
    expect(yearsUntilCollege(20)).toBe(0);
  });

  it("works out the monthly amount, as a range from best to worst case", () => {
    // $153,103.43 in 156 months at 6% a year.
    expect(monthlyToReach(15_310_343, 156, 0.06)).toBe(65_780);
    expect(monthlyToReach(12_000, 12, 0)).toBe(1_000);
    const range = monthlyRange("public", 5);
    expect(range.lowCents).toBe(65_780);
    expect(range.highCents).toBeGreaterThan(range.lowCents);
    // Money already saved lowers it.
    expect(monthlyRange("public", 5, 2_000_000).lowCents).toBeLessThan(range.lowCents);
  });

  it("becomes a goal at the middle of the range, by the September they start", () => {
    const goal = collegeGoal("Sam", "public", 5, "2026-10-19");
    const r = costRange("public", 5);
    expect(goal).toEqual({
      name: "College for Sam",
      targetCents: Math.round((r.lowCents + r.highCents) / 2),
      targetDate: "2039-09-01",
    });
  });
});

describe("the state's 529 tax break", () => {
  it("comes from the tax profile's state, and only with a plan it counts", () => {
    // New York: up to $5,000 deductible, home-state plan only.
    expect(stateBenefit(home, "NY", "single", 800_000)).toBe(
      Math.round(500_000 * stateRate("NY", "single")),
    );
    expect(stateBenefit(national, "NY", "single", 800_000)).toBe(0);
    expect(stateBenefit(home, "NY", "married_joint", 800_000)).toBe(
      Math.round(800_000 * stateRate("NY", "married_joint")),
    );
    // Pennsylvania counts any state's plan.
    expect(stateBenefit(national, "PA", "single", 800_000)).toBe(Math.round(800_000 * 0.0307));
    // Indiana gives a credit; a state with no break, or none on file, gives nothing.
    expect(stateBenefit(home, "IN", "single", 800_000)).toBe(150_000);
    expect(stateBenefit(home, "CA", "single", 800_000)).toBe(0);
    expect(stateBenefit(home, null, null, 800_000)).toBe(0);
    expect(stateRate("TX", "single")).toBe(0);
  });

  it("picks the plan that comes out ahead once fees are counted", () => {
    expect(comparePlans("NY", "single", 800_000, 15_000_000)[0].plan.key).toBe("home");
    // Without a state break the cheapest wins; the adviser-sold plan is last.
    const ca = comparePlans("CA", "single", 800_000, 15_000_000);
    expect(ca[0].plan.key).toBe("national");
    expect(ca.at(-1)?.plan.key).toBe("advisor");
  });
});
