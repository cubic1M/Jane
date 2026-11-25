import { describe, expect, it } from "vitest";
import { checkFrom } from "@/lib/tax-withholding";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { withholdingCheck } from "./withholding";

// CodeRabbit sweep 1c, pl-09 #10 and #11: Step 4(b) is sized and predicted with one rate, a 0%
// top rate can't be sized, and the January change never takes more than a paycheck withholds.

const base = {
  withholdingKnown: true,
  marginalRate: 0.22,
  perYear: 24,
  paychecksLeft: 4,
  withheldPerPaycheckCents: 56_557,
  lastYearRefundCents: null,
};

describe("Step 4(b) rate", () => {
  it("a 0% top rate gives no deduction to size", () => {
    expect(withholdingCheck({ ...base, marginalRate: 0, refundCents: 600_000 })).toEqual({
      status: "unknown",
      why: "no_rate",
    });
  });

  it("a bill at a 0% rate still gets Step 4(c)", () => {
    const check = withholdingCheck({ ...base, marginalRate: 0, refundCents: -150_000 });
    expect(check.status).toBe("bill_coming");
  });

  it("the capped amount is predicted at the rate it was sized with", () => {
    // Refund far above what 4 paychecks hold: the this-year change is capped at the withholding.
    const check = withholdingCheck({ ...base, marginalRate: 0.05, refundCents: 4_000_000 });
    if (check.status !== "big_refund" || !check.thisYear) throw new Error(check.status);
    const t = check.thisYear;
    // Sized at 10% (the floor): withheld * perYear / 0.1, rounded down; predicted at that same 10%.
    expect(t.perPaycheckCents).toBeLessThan(0);
    expect(Math.abs(t.perPaycheckCents)).toBeGreaterThan(base.withheldPerPaycheckCents * 0.99);
    expect(Math.abs(t.perPaycheckCents)).toBeLessThanOrEqual(base.withheldPerPaycheckCents);
  });
});

describe("January change", () => {
  it("never reduces withholding below what a paycheck has", () => {
    const check = withholdingCheck({ ...base, refundCents: 20_000_000 });
    if (check.status !== "big_refund") throw new Error(check.status);
    expect(check.fromJanuary.perPaycheckCents).toBeGreaterThanOrEqual(
      -base.withheldPerPaycheckCents,
    );
    expect(check.fromJanuary.refundAfterCents).toBe(
      20_000_000 + check.fromJanuary.perPaycheckCents * base.perYear,
    );
  });

  it("leaves a change inside the limit alone", () => {
    const check = withholdingCheck({ ...base, refundCents: 600_000 });
    if (check.status !== "big_refund") throw new Error(check.status);
    expect(check.fromJanuary.perPaycheckCents).toBeGreaterThan(-base.withheldPerPaycheckCents);
  });
});

describe("nothing withheld per paycheck (CodeRabbit sweep 1d, #2273)", () => {
  it("a big refund with no withholding to reduce offers no zero-dollar change", () => {
    const check = withholdingCheck({ ...base, withheldPerPaycheckCents: 0, refundCents: 600_000 });
    expect(check).toEqual({ status: "unknown", why: "no_withholding" });
  });

  it("a bill still gets Step 4(c) when nothing is withheld", () => {
    const check = withholdingCheck({ ...base, withheldPerPaycheckCents: 0, refundCents: -150_000 });
    expect(check.status).toBe("bill_coming");
  });
});

describe("a zero-tax estimate reaches no_rate through checkFrom", () => {
  it("wages under the standard deduction and a large refund size no deduction", () => {
    const input: EstimateInput = {
      year: 2026,
      filingStatus: "single",
      childrenUnder17: 0,
      otherDependants: 0,
      state: "IL",
      income: { ...NO_INCOME, wagesCents: 900_000, socialSecurityWagesCents: 900_000 },
      studentLoanInterestCents: 0,
      mortgageInterestCents: 0,
      charityCents: 0,
      medicalCents: 0,
      otherStateLocalTaxCents: 0,
      federalWithheldCents: 400_000,
      federalEstimatedPaidCents: 0,
      stateWithheldCents: 0,
      stateEstimatedPaidCents: 0,
    };
    const estimate = estimateTaxes(input);
    expect(estimate.incomeTaxCents).toBe(0);
    const check = checkFrom({
      estimate,
      input,
      withholdingKnown: true,
      paychecks: { perYear: 24, left: 4, withheldPerPaycheckCents: 16_000 },
      lastYearRefundCents: null,
    } as never);
    expect(check).toEqual({ status: "unknown", why: "no_rate" });
  });
});
