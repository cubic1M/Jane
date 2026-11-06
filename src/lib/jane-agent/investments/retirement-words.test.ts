import { describe, expect, it } from "vitest";
import { drawOrder, type Balances } from "@/planning/retirement-income";
import { profileSummary, type ProfileAnswers } from "@/planning/investor-profile";
import { retirementPlan, type RetirementInput } from "@/planning/retirement";
import { retirementReply } from "./replies";
import { drawLine } from "./retirement-income-copy";

// Night round 11-06, sample people at 3pm and 7pm: every one of them was told "Nothing to
// change: keep going as you are" with $5,000 projected at 67, because no sample person has a
// known pay, so the plan has no target and no changes. And with no taxable account the order
// to draw read "1. then pre-tax accounts (401(k), traditional ira)".
const ASOF = "2026-10-19";
const FULL: ProfileAnswers = {
  age: 45,
  ageOn: ASOF,
  horizon: "10_to_20",
  dropReaction: "worry",
  goals: ["retirement"],
  answeredAt: new Date("2026-10-19T12:00:00Z"),
  updatedAt: new Date("2026-10-19T12:00:00Z"),
};
const reply = (input: Partial<RetirementInput>) =>
  retirementReply(
    {
      profile: profileSummary(FULL, ASOF),
      balanceCents: input.balanceCents ?? 197_333,
      accounts: ["Demo 401(k)"],
      retirement: retirementPlan({
        age: 45,
        balanceCents: 197_333,
        employeeCents: 0,
        employerCents: 0,
        plan: null,
        ...input,
      }),
    },
    true,
  ).body;

describe("whether to keep going as you are", () => {
  it("doesn't say so when there's no pay to measure against", () => {
    const body = reply({});
    expect(body).not.toContain("Nothing to change");
    expect(body).toContain(
      "Whether that's enough I can't say yet: I don't see your pay before deductions or your employer's match.",
    );
  });

  it("says so when the low end already reaches the target", () => {
    const body = reply({
      balanceCents: 300_000_000,
      employeeCents: 500_000,
      employerCents: 250_000,
      plan: { payCents: 8_000_000, matchRate: 0.5, matchUpTo: 0.06 },
    });
    expect(body).toMatch(/on track for the target/);
    expect(body).toContain("Nothing to change: keep going as you are.");
  });

  it("doesn't say so when short of the target with nothing left to suggest", () => {
    // At the deferral limit already, so no step to put in more; the match is all taken.
    const plan = retirementPlan({
      age: 45,
      balanceCents: 100_000,
      employeeCents: 2_400_000,
      employerCents: 300_000,
      plan: { payCents: 50_000_000, matchRate: 0.5, matchUpTo: 0.01 },
    });
    expect(plan.status).toBe("behind");
    const body = retirementReply(
      {
        profile: profileSummary(FULL, ASOF),
        balanceCents: 100_000,
        accounts: ["Demo 401(k)"],
        retirement: { ...plan, changes: [] },
      },
      true,
    ).body;
    expect(body).toMatch(/short of the target/);
    expect(body).not.toContain("Nothing to change");
  });
});

describe("the order to draw", () => {
  const line = (balances: Balances) => drawLine({ draw: drawOrder(balances) } as never);

  it("numbers each kind by its own name, keeping IRA in capitals", () => {
    expect(line({ taxableCents: 1, preTaxCents: 1, rothCents: 1 })).toBe(
      "The order to draw: 1. taxable accounts, 2. pre-tax accounts (401(k), traditional IRA), 3. Roth.",
    );
    expect(line({ taxableCents: 0, preTaxCents: 1, rothCents: 1 })).toBe(
      "The order to draw: 1. pre-tax accounts (401(k), traditional IRA), 2. Roth.",
    );
  });

  it("says one kind plainly, without a list of one", () => {
    expect(line({ taxableCents: 0, preTaxCents: 1, rothCents: 0 })).toBe(
      "Draw from your pre-tax accounts (401(k), traditional IRA).",
    );
    expect(line({ taxableCents: 0, preTaxCents: 0, rothCents: 0 })).toBeNull();
  });
});
