import { describe, expect, it } from "vitest";
import { DIRECT_PAY, IRS_DIRECT_PAY_URL } from "@/config/tax";
import { directPaySteps, estimatedTaxYear } from "./direct-pay-steps";

// Connectors roadmap round 16: the values to type into IRS Direct Pay for an estimated payment.

const value = (steps: { label: string; value: string }[], label: string) =>
  steps.find((s) => s.label === label)?.value;

describe("the tax year being paid for", () => {
  it("is the year before for the January payment, the same year otherwise", () => {
    expect(estimatedTaxYear("2027-01-15")).toBe(2026);
    expect(estimatedTaxYear("2026-04-15")).toBe(2026);
    expect(estimatedTaxYear("2026-06-15")).toBe(2026);
    expect(estimatedTaxYear("2026-09-15")).toBe(2026);
  });
});

describe("directPaySteps", () => {
  it("puts the January 15, 2027 payment toward 2026, as Estimated Tax on a 1040ES", () => {
    const pay = directPaySteps({ dueOn: "2027-01-15", cents: 125_050, today: "2026-11-06" });
    expect(pay.url).toBe(IRS_DIRECT_PAY_URL);
    expect(pay.taxYear).toBe(2026);
    expect(pay.payOn).toBe("2027-01-15");
    expect(pay.late).toBe(false);
    expect(value(pay.steps, "Reason for payment")).toBe("Estimated Tax");
    expect(value(pay.steps, "Apply payment to")).toBe("1040ES");
    expect(value(pay.steps, "Tax period for payment")).toBe("2026");
    expect(value(pay.steps, "Payment amount")).toBe("$1,250.50");
    expect(value(pay.steps, "Verify it's you")).toContain("before 2026");
    expect(value(pay.steps, "Confirmation number")).toContain("can't show it again");
  });

  it("pays a missed date today, still for the year it was due in", () => {
    const pay = directPaySteps({ dueOn: "2026-09-15", cents: 50_000, today: "2026-11-06" });
    expect(pay).toMatchObject({ payOn: "2026-11-06", late: true, taxYear: 2026 });
  });

  it("says the cancel and daily limits", () => {
    const changing = value(
      directPaySteps({ dueOn: "2026-12-01", cents: 1, today: "2026-11-06" }).steps,
      "Changing it",
    );
    expect(changing).toContain(`${DIRECT_PAY.cancelBusinessDays} business days`);
    expect(changing).toContain(`at most ${DIRECT_PAY.maxPerDay} payments`);
  });

  it("refuses a date more than a year ahead, or no amount", () => {
    expect(() => directPaySteps({ dueOn: "2027-11-07", cents: 100, today: "2026-11-06" })).toThrow(
      "at most 365 days ahead",
    );
    expect(directPaySteps({ dueOn: "2027-11-06", cents: 100, today: "2026-11-06" }).payOn).toBe(
      "2027-11-06",
    );
    expect(() => directPaySteps({ dueOn: "2026-12-01", cents: 0, today: "2026-11-06" })).toThrow();
  });
});
