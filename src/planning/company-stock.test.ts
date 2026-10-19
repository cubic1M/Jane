import { describe, expect, it } from "vitest";
import { EMPLOYER_STOCK_LIMIT, MIN_PART_CENTS } from "@/config/company-stock";
import { concentration, diversifyPlan } from "./company-stock";

// Spec step 160: company stock against the limit, and the plan to sell it down in parts.

describe("concentration", () => {
  it("is the share of what's invested, with and without what's still to vest", () => {
    const c = concentration({
      heldCents: 2_000_000,
      unvestedCents: 1_000_000,
      totalInvestedCents: 10_000_000,
    });
    expect(c.share).toBe(0.2);
    expect(c.shareWithUnvested).toBeCloseTo(3 / 11);
    expect(c.overLimit).toBe(true);
    expect(
      concentration({ heldCents: 1_000_000, unvestedCents: 0, totalInvestedCents: 10_000_000 })
        .overLimit,
    ).toBe(false);
    expect(concentration({ heldCents: 0, unvestedCents: 0, totalInvestedCents: 0 }).share).toBe(0);
  });
  it("uses the 10% limit from FINRA", () => {
    expect(EMPLOYER_STOCK_LIMIT).toBe(0.1);
  });
});

// Worked example: 200 shares at $100 ($20,000) bought for $50 each, in $100,000 invested.
// 40 shares are from before the history (long-term); 160 were bought on 2026-06-01.
const INPUT = {
  quantity: 200,
  priceCents: 10_000,
  costBasisCents: 1_000_000,
  lots: [
    { date: null, quantity: 40 },
    { date: "2026-06-01", quantity: 160 },
  ],
  totalInvestedCents: 10_000_000,
  today: "2026-10-19",
  rates: { longTerm: 0.15, shortTerm: 0.22 },
};

describe("diversifyPlan", () => {
  it("sells down to the limit in 4 parts 3 months apart, oldest shares first, with the tax", () => {
    const plan = diversifyPlan(INPUT);
    expect(plan.sellCents).toBe(1_000_000);
    expect(plan.parts.map((p) => [p.on, p.shares, p.proceedsCents])).toEqual([
      ["2026-10-19", 25, 250_000],
      ["2027-01-19", 25, 250_000],
      ["2027-04-19", 25, 250_000],
      ["2027-07-19", 25, 250_000],
    ]);
    // Part 1: 25 old shares, long-term: $1,250 gain × 15% = $187.50.
    // Part 2: 15 old (long) and 10 of June's, held 232 days (short): $112.50 + $110.00.
    // Part 3: 25 of June's at 322 days, short: $1,250 × 22% = $275.00.
    // Part 4: 25 of June's at 413 days, long again: $187.50.
    expect(plan.parts.map((p) => [p.longTermCents, p.shortTermCents, p.taxCents])).toEqual([
      [125_000, 0, 18_750],
      [75_000, 50_000, 22_250],
      [0, 125_000, 27_500],
      [125_000, 0, 18_750],
    ]);
    expect(plan.taxCents).toBe(87_250);
    expect(plan.shareBefore).toBe(0.2);
    expect(plan.shareAfter).toBe(0.1);
    // A 50% drop: $10,000 lost before, $5,000 after.
    expect(plan.dropBeforeCents).toBe(1_000_000);
    expect(plan.dropAfterCents).toBe(500_000);
  });

  it("counts company stock held elsewhere towards the limit, selling only from here", () => {
    const plan = diversifyPlan({
      ...INPUT,
      quantity: 100,
      costBasisCents: 500_000,
      lots: [{ date: null, quantity: 100 }],
      otherCents: 1_500_000,
    });
    // $25,000 in all against a $10,000 limit, but only the $10,000 here can be sold.
    expect(plan.sellCents).toBe(1_000_000);
    expect(plan.shareBefore).toBe(0.25);
    expect(plan.shareAfter).toBe(0.15);
  });

  it("has no parts under the limit, or when the excess is too small to sell", () => {
    expect(diversifyPlan({ ...INPUT, totalInvestedCents: 30_000_000 }).parts).toEqual([]);
    const small = diversifyPlan({
      ...INPUT,
      totalInvestedCents: Math.ceil((2_000_000 - MIN_PART_CENTS + 100) / EMPLOYER_STOCK_LIMIT),
    });
    expect(small.parts).toEqual([]);
    expect(small.taxCents).toBe(0);
  });

  it("uses fewer parts when each would be under the minimum, and no tax on a loss", () => {
    const loss = diversifyPlan({ ...INPUT, totalInvestedCents: 19_000_000 });
    // $20,000 against a $19,000 limit: $1,000 to sell, in two $500 parts.
    expect(loss.parts.map((p) => p.proceedsCents)).toEqual([50_000, 50_000]);
    const underwater = diversifyPlan({ ...INPUT, costBasisCents: 3_000_000 });
    expect(underwater.parts.every((p) => p.gainCents < 0 && p.taxCents === 0)).toBe(true);
  });
});
