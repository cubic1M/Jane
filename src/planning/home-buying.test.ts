import { describe, expect, it } from "vitest";
import { affordability, homeCosts, savingPlan } from "./home-buying";

describe("what a home costs a month", () => {
  it("adds the loan, property tax, insurance and PMI under 20% down", () => {
    const c = homeCosts({ priceCents: 40_000_000, downShare: 0.1, aprBps: 579, termMonths: 360 });
    expect(c.downCents).toBe(4_000_000);
    expect(c.loanCents).toBe(36_000_000);
    expect(c.principalAndInterestCents).toBeGreaterThan(200_000);
    expect(c.principalAndInterestCents).toBeLessThan(220_000);
    expect(c.propertyTaxCents).toBe(Math.round((40_000_000 * 0.011) / 12));
    expect(c.insuranceCents).toBe(Math.round((40_000_000 * 0.0035) / 12));
    expect(c.pmiCents).toBe(Math.round((36_000_000 * 0.007) / 12));
    expect(c.housingCents).toBe(
      c.principalAndInterestCents + c.propertyTaxCents + c.insuranceCents + c.pmiCents,
    );
    expect(c.closingCents).toBe(1_200_000);
    expect(c.cashNeededCents).toBe(5_200_000);
  });
  it("has no PMI at 20% down", () => {
    const c = homeCosts({ priceCents: 40_000_000, downShare: 0.2, aprBps: 579, termMonths: 360 });
    expect(c.pmiCents).toBe(0);
  });
});

describe("what a person can afford", () => {
  const base = { downShare: 0.1, aprBps: 579, termMonths: 360 };
  it("keeps housing under 28% of gross and all debt under 36%", () => {
    const a = affordability({ ...base, monthlyNetIncomeCents: 780_000, debtPaymentsCents: 0 });
    expect(a.grossMonthlyCents).toBe(1_000_000);
    expect(a.housingLimitCents).toBe(280_000);
    expect(a.debtLimitCents).toBe(360_000);
    expect(a.allowedHousingCents).toBe(280_000);
    const cost = (price: number) => homeCosts({ ...base, priceCents: price }).housingCents;
    expect(cost(a.maxPriceCents)).toBeLessThanOrEqual(280_000);
    expect(cost(a.maxPriceCents + 500_000)).toBeGreaterThan(280_000);
  });
  it("lets other debt payments take away from the 36% limit", () => {
    const free = affordability({ ...base, monthlyNetIncomeCents: 780_000, debtPaymentsCents: 0 });
    const indebted = affordability({
      ...base,
      monthlyNetIncomeCents: 780_000,
      debtPaymentsCents: 150_000,
    });
    expect(indebted.allowedHousingCents).toBe(210_000);
    expect(indebted.maxPriceCents).toBeLessThan(free.maxPriceCents);
    const buried = affordability({
      ...base,
      monthlyNetIncomeCents: 780_000,
      debtPaymentsCents: 400_000,
    });
    expect(buried.allowedHousingCents).toBe(0);
    expect(buried.maxPriceCents).toBe(0);
  });
});

describe("saving for the cash needed", () => {
  const input = { cashNeededCents: 5_200_000, asOf: "2026-10-19", targetDate: "2028-10-19" };
  it("says what to save a month by the date, and how long the current pace takes", () => {
    const p = savingPlan({ ...input, savedCents: 1_000_000, monthlySavingCents: 100_000 });
    expect(p.stillNeededCents).toBe(4_200_000);
    expect(p.monthsToTarget).toBe(24);
    expect(p.monthlyNeededCents).toBe(175_000);
    expect(p.monthsAtCurrentPace).toBe(42);
    expect(p.onTrack).toBe(false);
  });
  it("is on track when the pace is enough, and done when it's saved", () => {
    expect(
      savingPlan({ ...input, savedCents: 1_000_000, monthlySavingCents: 200_000 }).onTrack,
    ).toBe(true);
    const done = savingPlan({ ...input, savedCents: 6_000_000, monthlySavingCents: 0 });
    expect(done).toMatchObject({ stillNeededCents: 0, monthsAtCurrentPace: 0, onTrack: true });
  });
  it("has no pace to speak of when nothing is saved a month", () => {
    expect(
      savingPlan({ ...input, savedCents: 0, monthlySavingCents: 0 }).monthsAtCurrentPace,
    ).toBeNull();
  });
});
