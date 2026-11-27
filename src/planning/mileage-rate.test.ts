import { describe, expect, it } from "vitest";
import { NoTaxParamsError } from "@/config/tax-params";
import { MILEAGE_RATE_CENTS, MILEAGE_RATE_NOTE, businessMileageCentsOn } from "@/config/tax-rates";
import { mileageDeduction } from "@/planning/self-employed";

// Tax T4 PR 1: the IRS business rate is 72.5 cents to June 30, 2026 and 76 cents from July 1
// (IRS standard mileage rates page, read 2026-11-27). A mile is priced by the day it was driven.
describe("business mileage rate by the trip's own date", () => {
  it("is 72.5 cents through June 30 and 76 from July 1, 2026", () => {
    expect(businessMileageCentsOn("2026-01-01")).toBe(72.5);
    expect(businessMileageCentsOn("2026-06-30")).toBe(72.5);
    expect(businessMileageCentsOn("2026-07-01")).toBe(76);
    expect(businessMileageCentsOn("2026-12-31")).toBe(76);
  });

  it("uses 2025's own rate (70 cents) for a 2025 trip and refuses a year it has no rate for", () => {
    expect(businessMileageCentsOn("2025-12-31")).toBe(70);
    expect(() => businessMileageCentsOn("2027-01-01")).toThrow(NoTaxParamsError);
    expect(() => businessMileageCentsOn("2024-06-01")).toThrow(NoTaxParamsError);
  });

  it("HE-T4a: 1,000 miles on 2026-07-15 are $760.00; the same miles on 2026-05-15 are $725.00", () => {
    // 1,000 x 76 cents = 76,000 cents; 1,000 x 72.5 cents = 72,500 cents.
    expect(mileageDeduction(1_000, "2026-07-15")).toBe(76_000);
    expect(mileageDeduction(1_000, "2026-05-15")).toBe(72_500);
  });

  it("miles with no date use the first period's rate and the note says so", () => {
    expect(MILEAGE_RATE_CENTS).toBe(72.5);
    expect(mileageDeduction(1_000)).toBe(72_500);
    expect(mileageDeduction(null)).toBe(0);
    expect(MILEAGE_RATE_NOTE).toBe(
      "Miles with no date are counted at 72.5 cents, the IRS rate for January 1 to June 30. " +
        "The IRS rate is 76 cents for July 1 to December 31, so miles driven then are worth a little more than this shows.",
    );
  });
});
