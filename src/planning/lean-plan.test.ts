import { describe, expect, it } from "vitest";
import { leanMessage, leanPlan } from "./lean-plan";

const input = {
  cashCents: 1_200_000,
  monthlySpendingCents: 300_000,
  forecastBillsCents: 350_000,
  waitable: [
    { name: "Netflix", monthlyCents: 1_599 },
    { name: "Gym", monthlyCents: 4_500 },
  ],
  debts: [
    { name: "Demo Credit Card", kind: "credit" },
    { name: "Demo Student Loan", kind: "student" },
  ],
  stateName: "California",
};

describe("leanPlan", () => {
  it("works the runway from the larger of spending and the forecast's bills", () => {
    const plan = leanPlan(input);
    expect(plan.outflowCents).toBe(350_000);
    expect(plan.runwayMonths).toBe(3.4);
    expect(plan.waitableCents).toBe(6_099);
    expect(plan.runwayWithoutWaitMonths).toBeGreaterThan(plan.runwayMonths!);
    expect(plan.waitable.map((w) => w.name)).toEqual(["Gym", "Netflix"]);
  });

  it("gives each debt a hardship option and falls back for unknown kinds", () => {
    const plan = leanPlan({ ...input, debts: [...input.debts, { name: "Odd", kind: "other" }] });
    expect(plan.hardship.map((h) => h.program)).toEqual([
      "Card hardship program",
      "Student loan deferment or income-driven plan",
      "Loan hardship options",
    ]);
  });

  it("names the state for the unemployment steps", () => {
    expect(leanPlan(input).unemployment.intro).toContain('"California unemployment insurance"');
    expect(leanPlan({ ...input, stateName: null }).unemployment.intro).toMatch(/federal directory/);
  });

  it("says it in one message, with no cash and no spending handled", () => {
    expect(leanMessage(leanPlan(input))).toMatch(
      /^Your cash covers about 3\.4 months at \$3,500\.00 a month\. These could wait or be paused: Gym \(\$45\.00\), Netflix \(\$15\.99\)/,
    );
    expect(
      leanMessage(leanPlan({ ...input, monthlySpendingCents: 0, forecastBillsCents: 0 })),
    ).toMatch(/^I can't work out how long your cash lasts yet\./);
  });
});
