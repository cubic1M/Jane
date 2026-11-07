import { describe, expect, it } from "vitest";
import { paystubSaving, sortDeduction } from "./paystub-deductions";
import { matchGap } from "./retirement-accounts";

// Connectors roadmap round 17: paystub deduction lines, sorted.

describe("sortDeduction", () => {
  it("reads the ways payroll systems print a plan contribution", () => {
    for (const name of [
      "401K",
      "401(k)",
      "401 K PRE-TAX",
      "403B DEFERRAL",
      "457(b)",
      "TSP",
      "DEFERRED COMP",
    ]) {
      expect(sortDeduction(name, 100).kind, name).toBe("pretax_plan");
    }
  });

  it("tells a Roth contribution and a loan repayment apart from a plain one", () => {
    for (const name of ["ROTH 401K", "401K ROTH", "Roth 403(b)", "ROTH TSP"]) {
      expect(sortDeduction(name, 100).kind, name).toBe("roth_plan");
    }
    for (const name of ["401K LOAN", "LOAN 401(K) #1", "K-LOAN REPAY"]) {
      expect(sortDeduction(name, 100).kind, name).toBe("plan_loan");
    }
  });

  it("names a state auto-IRA", () => {
    expect(sortDeduction("CALSAVERS", 100)).toEqual({
      kind: "state_auto_ira",
      cents: 100,
      programme: "CalSavers",
    });
    expect(sortDeduction("OregonSaves Roth IRA", 100).programme).toBe("OregonSaves");
    expect(sortDeduction("ILLINOIS SECURE CHOICE", 100).programme).toBe("My Illinois Savings");
  });

  it("leaves anything else as other, never guessed", () => {
    for (const name of [
      "MEDICAL",
      "DENTAL PRETAX",
      "HSA",
      "FSA",
      "UNION DUES",
      "SAVINGS BOND",
      "4010 PARKING",
    ]) {
      expect(sortDeduction(name, 100).kind, name).toBe("other");
    }
  });
});

describe("paystubSaving", () => {
  it("adds up what went to saving as a share of gross, leaving out a loan repayment", () => {
    const stub = paystubSaving({
      grossCents: 340_000,
      deductions: [
        { name: "401K", cents: 10_200 },
        { name: "ROTH 401K", cents: 3_400 },
        { name: "401K LOAN", cents: 12_000 },
        { name: "MEDICAL", cents: 8_000 },
      ],
    });
    expect(stub).toMatchObject({
      savedCents: 13_600,
      planCents: 13_600,
      loanCents: 12_000,
      programme: null,
    });
    expect(stub.rate).toBeCloseTo(0.04);
    // Into the existing match arithmetic: 4% against a 50% match up to 6%.
    const gap = matchGap({
      payCents: 340_000 * 24,
      employeeCents: stub.planCents * 24,
      matchRate: 0.5,
      matchUpTo: 0.06,
    });
    expect(gap.missedCents).toBe(Math.round(0.02 * 340_000 * 24 * 0.5));
  });

  it("reads a negative deduction as an amount taken, and names the auto-IRA", () => {
    const stub = paystubSaving({
      grossCents: 200_000,
      deductions: [{ name: "CalSavers", cents: -10_000 }],
    });
    expect(stub).toMatchObject({ savedCents: 10_000, planCents: 0, programme: "CalSavers" });
    expect(paystubSaving({ grossCents: 0, deductions: [] }).rate).toBe(0);
  });
});
