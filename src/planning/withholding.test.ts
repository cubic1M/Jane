import { describe, expect, it } from "vitest";
import { WITHHOLDING } from "@/config/tax";
import { perPaycheckEffect, withholdingCheck } from "./withholding";

// Spec step 121: the W-4 change moves the estimate toward zero owed and a small refund.

const base = {
  withholdingKnown: true,
  marginalRate: 0.22,
  perYear: 24,
  paychecksLeft: 4,
  withheldPerPaycheckCents: 56_557,
  lastYearRefundCents: null,
};
const target = WITHHOLDING.targetRefundCents;

describe("withholdingCheck", () => {
  it("says on track for a small refund or a small bill", () => {
    expect(withholdingCheck({ ...base, refundCents: 50_000 })).toEqual({
      status: "on_track",
      refundCents: 50_000,
    });
    expect(withholdingCheck({ ...base, refundCents: -5_000 }).status).toBe("on_track");
  });

  it("can't check without paychecks or withholding", () => {
    expect(withholdingCheck({ ...base, perYear: null, refundCents: 0 })).toEqual({
      status: "unknown",
      why: "no_pay",
    });
    expect(withholdingCheck({ ...base, withholdingKnown: false, refundCents: 0 })).toEqual({
      status: "unknown",
      why: "no_withholding",
    });
  });

  it("a bill: Step 4(c) extra per paycheck lands on a small refund", () => {
    const check = withholdingCheck({ ...base, refundCents: -150_000 });
    if (check.status !== "bill_coming") throw new Error(check.status);
    // ($1,500 + $300) over 4 paychecks: $450 each.
    expect(check.thisYear).toEqual({
      step: "4c",
      amountCents: 45_000,
      perPaycheckCents: 45_000,
      refundAfterCents: 30_000,
    });
    // From January the same gap over 24 paychecks, rounded up to a dollar.
    expect(check.fromJanuary).toMatchObject({ step: "4c", amountCents: 7_500 });
    expect(check.fromJanuary.refundAfterCents).toBeGreaterThanOrEqual(target);
  });

  it("a big refund: Step 4(b) deductions bring it down to a small refund, never below zero", () => {
    for (const refundCents of [150_000, 416_637, 900_000]) {
      const check = withholdingCheck({ ...base, refundCents });
      if (check.status !== "big_refund") throw new Error(check.status);
      expect(check.thisYear!.step).toBe("4b");
      expect(check.thisYear!.refundAfterCents).toBeGreaterThanOrEqual(0);
      expect(check.thisYear!.refundAfterCents).toBeLessThan(refundCents);
      expect(check.fromJanuary.refundAfterCents).toBeGreaterThanOrEqual(target);
      expect(check.fromJanuary.refundAfterCents).toBeLessThan(target + 10_000);
    }
  });

  it("never takes off more than a paycheck's withholding", () => {
    const check = withholdingCheck({
      ...base,
      refundCents: 900_000,
      withheldPerPaycheckCents: 20_000,
    });
    if (check.status !== "big_refund") throw new Error(check.status);
    expect(-check.thisYear!.perPaycheckCents).toBeLessThanOrEqual(20_000);
  });

  it("with no paychecks left this year, only says what to do from January", () => {
    const check = withholdingCheck({ ...base, paychecksLeft: 0, refundCents: 300_000 });
    if (check.status !== "big_refund") throw new Error(check.status);
    expect(check.thisYear).toBeNull();
  });

  it("a big refund last year counts, even when this year's is smaller", () => {
    expect(withholdingCheck({ ...base, refundCents: 60_000 }).status).toBe("on_track");
    expect(
      withholdingCheck({ ...base, refundCents: 60_000, lastYearRefundCents: 250_000 }).status,
    ).toBe("big_refund");
  });

  it("Step 4(b) takes a yearly amount at the top rate, spread over the paychecks", () => {
    expect(perPaycheckEffect("4b", 2_400_000, 0.22, 24)).toBe(-22_000);
    expect(perPaycheckEffect("4c", 5_000, 0.22, 24)).toBe(5_000);
  });
});
