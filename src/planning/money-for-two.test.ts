import { describe, expect, it } from "vitest";
import {
  HALF,
  incomeSplitMatters,
  needsBothTaps,
  partnerShareBps,
  sharesWords,
  twoEarners,
} from "./money-for-two";

// Spec step 242, pure: shares by income, when a split is worth suggesting, the both-taps rule.

describe("money for two", () => {
  it("splits half each, or by what each earns", () => {
    expect(partnerShareBps("even", 300_000, 100_000)).toBe(HALF);
    expect(partnerShareBps("income", 300_000, 100_000)).toBe(2_500);
    expect(partnerShareBps("income", 100_000, 300_000)).toBe(7_500);
    // Half when either income isn't known; never all or nothing.
    expect(partnerShareBps("income", 0, 300_000)).toBe(HALF);
    expect(partnerShareBps("income", 1, 10_000_000)).toBe(9_900);
  });

  it("suggests splitting by income only when it moves the shares by ten points or more", () => {
    expect(incomeSplitMatters(4_500)).toBe(false);
    expect(incomeSplitMatters(3_400)).toBe(true);
    expect(incomeSplitMatters(6_000)).toBe(true);
    expect(sharesWords(6_600)).toBe("66/34");
  });

  it("holds big moves out of shared accounts for both taps", () => {
    expect(needsBothTaps(true, 100_000, 100_000)).toBe(true);
    expect(needsBothTaps(true, 99_999, 100_000)).toBe(false);
    expect(needsBothTaps(false, 500_000, 100_000)).toBe(false);
  });

  it("finds the two earners from their payrolls", () => {
    expect(
      twoEarners([
        { description: "MERIDIAN LOGISTICS PAYROLL", cents: 325_000 },
        { description: "COUNTY LIBRARY PAYROLL", cents: 165_000 },
        { description: "MERIDIAN LOGISTICS PAYROLL", cents: 325_000 },
      ]),
    ).toEqual({
      first: { name: "MERIDIAN LOGISTICS", cents: 650_000 },
      second: { name: "COUNTY LIBRARY", cents: 165_000 },
    });
    expect(twoEarners([{ description: "ACME CORP PAYROLL", cents: 500_000 }])).toBeNull();
  });
});
