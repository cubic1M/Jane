import { describe, expect, it } from "vitest";
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
