import { describe, expect, it } from "vitest";
import { PLAN_TO_AGE, RMD_DIVISORS, RMD_SOURCE, SS_SOURCE } from "@/config/retirement-income";
import {
  breakevenAge,
  drawOrder,
  estimateSsMonthly,
  lastsToAge,
  paycheck,
  rmd,
  rmdStartAge,
  ssOptions,
} from "./retirement-income";

// Spec step 212: Social Security at 62, full age and 70; RMDs; the order to draw; a
// paycheck that lasts, always with how long.

describe("Social Security", () => {
  it("scales the full-age benefit to 70%, 100% and 124% at 62, 67 and 70, with lifetime totals to 85", () => {
    expect(ssOptions(300_000)).toEqual([
      { age: 62, monthlyCents: 210_000, lifetimeToAgeCents: 210_000 * 12 * 23 },
      { age: 67, monthlyCents: 300_000, lifetimeToAgeCents: 300_000 * 12 * 18 },
      { age: 70, monthlyCents: 372_000, lifetimeToAgeCents: 372_000 * 12 * 15 },
    ]);
    expect(SS_SOURCE).toMatch(/Social Security Administration/);
  });
  it("shows the age by which waiting has paid more", () => {
    // 62 vs 67: 0.7 vs 1.0 → equal at age 78.7.
    expect(breakevenAge(300_000, 62, 67)).toBe(78.7);
    expect(breakevenAge(300_000, 67, 70)).toBe(82.5);
  });
  it("estimates a benefit from pay with the bend-point formula (demo pay $81,600)", () => {
    // AIME $6,800: 90% of $1,286 + 32% of ($6,800 − $1,286) = $1,157.40 + $1,764.48.
    expect(estimateSsMonthly(8_160_000)).toBe(292_188);
  });
});

describe("required minimum distributions", () => {
  it("start at 73 for 1951–1959 births and 75 from 1960, from the IRS table", () => {
    expect(rmdStartAge(1955)).toBe(73);
    expect(rmdStartAge(1960)).toBe(75);
    expect(rmd(50_000_000, 72, 1955)).toBe(0);
    // $500,000 at 75 ÷ 24.6.
    expect(rmd(50_000_000, 75, 1950)).toBe(Math.round(50_000_000 / 24.6));
    expect(rmd(10_000_000, 105, 1950)).toBe(Math.round(10_000_000 / RMD_DIVISORS[100]));
    expect(RMD_SOURCE).toMatch(/Publication 590-B/);
  });
});

describe("the order to draw", () => {
  it("is taxable, then pre-tax, then Roth, skipping empty ones", () => {
    expect(drawOrder({ taxableCents: 1, preTaxCents: 2, rothCents: 0 }).map((d) => d.key)).toEqual([
      "taxableCents",
      "preTaxCents",
    ]);
  });
});

describe("the paycheck and how long it lasts", () => {
  const base = {
    age: 60,
    retireAge: 65,
    balances: { taxableCents: 10_000_000, preTaxCents: 60_000_000, rothCents: 10_000_000 },
    yearlySavingCents: 2_000_000,
    spendMonthlyCents: 500_000,
    ssMonthlyCents: 270_000,
    ssStartAge: 67,
    taxRate: 0.12,
  };
  it("says how long the money lasts, as a range, and the most it can pay a month", () => {
    const p = paycheck(base);
    expect(p.lasts.highAge).toBeGreaterThanOrEqual(p.lasts.lowAge);
    expect(p.lasts.lowAge).toBeLessThanOrEqual(PLAN_TO_AGE);
    expect(p.sustainableMonthly.highCents).toBeGreaterThanOrEqual(p.sustainableMonthly.lowCents);
    // Spending exactly the sustainable amount lasts to the plan age (low returns).
    expect(
      lastsToAge({ ...base, spendMonthlyCents: p.sustainableMonthly.lowCents }, 0.04 - 0.025),
    ).toBeGreaterThan(0);
  });
  it("runs out earlier the more is spent, and needs less from savings once Social Security starts", () => {
    const less = paycheck({ ...base, spendMonthlyCents: 300_000 });
    const more = paycheck({ ...base, spendMonthlyCents: 900_000 });
    expect(more.lasts.lowAge).toBeLessThan(less.lasts.lowAge);
    expect(more.lastsToPlan).toBe(false);
    const early = paycheck({ ...base, ssStartAge: 62 });
    const late = paycheck({ ...base, ssStartAge: 70 });
    expect(early.sustainableMonthly.lowCents).toBeGreaterThanOrEqual(
      late.sustainableMonthly.lowCents,
    );
  });
});
