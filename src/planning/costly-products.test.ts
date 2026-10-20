import { describe, expect, it } from "vitest";
import {
  contractYear,
  exitComparison,
  feeGap,
  surrenderByYear,
  surrenderEndsOn,
  surrenderPct,
  wholeLifeCompare,
  yearlyCost,
} from "./costly-products";

// Spec step 215: fee and surrender math, tested.

const SCHEDULE = [7, 6, 5, 4, 3, 2, 1];

describe("yearly cost and surrender charges", () => {
  it("is the value times the fee: $85,000 at 2.55% costs $2,167.50 a year", () => {
    expect(yearlyCost(8_500_000, 255)).toBe(216_750);
  });
  it("finds the contract year, and the charge by year until it reaches zero", () => {
    expect(contractYear("2023-10-18", "2026-10-18")).toBe(4);
    expect(contractYear("2023-10-18", "2026-10-17")).toBe(3);
    expect(contractYear("2026-10-18", "2026-10-18")).toBe(1);
    expect(surrenderPct(SCHEDULE, 4)).toBe(4);
    expect(surrenderPct(SCHEDULE, 8)).toBe(0);
    expect(surrenderByYear(8_500_000, SCHEDULE, 4)).toEqual([
      { year: 4, pct: 4, cents: 340_000 },
      { year: 5, pct: 3, cents: 255_000 },
      { year: 6, pct: 2, cents: 170_000 },
      { year: 7, pct: 1, cents: 85_000 },
      { year: 8, pct: 0, cents: 0 },
    ]);
    expect(surrenderEndsOn("2023-10-18", SCHEDULE)).toBe("2030-10-18");
  });
});

describe("what the same money would do in a low-cost fund", () => {
  it("is a range, the gap in what it costs over 20 years, never a promise", () => {
    const gap = feeGap(8_500_000, 255);
    expect(gap.years).toBe(20);
    expect(gap.lowCents).toBeGreaterThan(0);
    expect(gap.highCents).toBeGreaterThan(gap.lowCents);
    expect(feeGap(8_500_000, 4).lowCents).toBe(0);
  });
});

describe("when getting out costs less than staying", () => {
  const base = {
    valueCents: 8_500_000,
    feeBps: 255,
    schedule: SCHEDULE,
    purchasedOn: "2023-10-18",
    today: "2026-10-18",
  };
  it("compares staying, leaving now (with the surrender charge) and waiting it out", () => {
    const e = exitComparison(base);
    // Staying: $2,167.50 × 10. Leaving now: the $3,400 charge (4% in year 4) plus $34 a year.
    expect(e.stayCents).toBe(2_167_500);
    expect(e.surrenderNowCents).toBe(340_000);
    expect(e.leaveNowCents).toBe(340_000 + 3_400 * 10);
    expect(e.surrenderEndsOn).toBe("2030-10-18");
    // Waiting 4 years pays the fee 4 times, then no charge at all: the cheapest.
    expect(e.bestWaitYears).toBeGreaterThanOrEqual(0);
    expect(e.bestCents).toBeLessThanOrEqual(e.leaveNowCents);
    expect(e.verdict === "leave_now" || e.verdict === "wait").toBe(true);
    expect(e.bestCents).toBeLessThan(e.stayCents);
  });
  it("says stay when the fee is already low", () => {
    expect(exitComparison({ ...base, feeBps: 6 }).verdict).toBe("stay");
  });
  it("never shows an exit without the surrender charge and when it ends", () => {
    const e = exitComparison(base);
    expect(e.surrenderNowCents).toBeGreaterThan(0);
    expect(e.surrenderEndsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("whole life", () => {
  it("shows premiums paid, cash value, what leaving returns, and the same premiums in funds as a range", () => {
    const w = wholeLifeCompare({
      premiumYearlyCents: 600_000,
      years: 6,
      cashValueCents: 2_840_000,
      surrenderPctNow: 5,
    });
    expect(w).toMatchObject({
      paidCents: 3_600_000,
      cashValueCents: 2_840_000,
      surrenderCents: 142_000,
      leaveNowCents: 2_698_000,
    });
    expect(w.inFundsCents.lowCents).toBeGreaterThan(3_600_000);
    expect(w.inFundsCents.highCents).toBeGreaterThan(w.inFundsCents.lowCents);
  });
});
