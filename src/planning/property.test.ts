import { describe, expect, it } from "vitest";
import { homeEquity, interestOver, paydownVsInvest, rentalFigures } from "./property";

// Spec step 214: home equity, depreciation, a rental's figures, paydown against investing.

describe("rentalFigures", () => {
  it("matches the transactions: cash flow is what hit the bank, profit takes interest not principal", () => {
    // A year: $1,850 × 12 rent; $1,120 × 12 mortgage ($1,052 interest a month, say); taxes and repairs.
    const f = rentalFigures({
      rentCents: 2_220_000,
      mortgagePaidCents: 1_344_000,
      propertyTaxCents: 230_000,
      otherExpensesCents: 150_000,
      mortgageInterestCents: 1_130_000,
      depreciationCents: 756_288,
      cashInvestedCents: 6_500_000,
    });
    expect(f.cashFlowCents).toBe(2_220_000 - 1_344_000 - 230_000 - 150_000);
    expect(f.principalCents).toBe(214_000);
    expect(f.profitCents).toBe(2_220_000 - 230_000 - 150_000 - 1_130_000);
    expect(f.taxableCents).toBe(f.profitCents - 756_288);
    expect(f.cashOnCash).toBeCloseTo(496_000 / 6_500_000);
    expect(f.returnWithPrincipal).toBeCloseTo((496_000 + 214_000) / 6_500_000);
  });
  it("has no return without cash put in", () => {
    expect(
      rentalFigures({
        rentCents: 1,
        mortgagePaidCents: 0,
        propertyTaxCents: 0,
        otherExpensesCents: 0,
        mortgageInterestCents: 0,
        depreciationCents: 0,
        cashInvestedCents: 0,
      }).cashOnCash,
    ).toBeNull();
  });
});

describe("home equity and paydown against investing", () => {
  it("is value less the loan", () => {
    expect(homeEquity(45_000_000, 31_240_000)).toBe(13_760_000);
  });
  it("charges interest on the falling balance", () => {
    // $182,000 at 6.25% over a year with $1,120 paid: first month $948.
    const y = interestOver(18_200_000, 625, 112_000, 12);
    expect(y.interestCents).toBeGreaterThan(1_100_000);
    expect(y.balanceCents).toBeLessThan(18_200_000);
  });
  it("shows both sides, and says which wins only when the rate is clear of the whole range", () => {
    const high = paydownVsInvest({
      balanceCents: 18_200_000,
      rateBps: 750,
      paymentCents: 112_000,
      extraMonthlyCents: 50_000,
    });
    expect(high.verdict).toBe("paydown");
    expect(high.paydown.interestSavedCents).toBeGreaterThan(0);
    expect(high.invest.highGainCents).toBeGreaterThan(high.invest.lowGainCents);
    const low = paydownVsInvest({
      balanceCents: 18_200_000,
      rateBps: 300,
      paymentCents: 112_000,
      extraMonthlyCents: 50_000,
    });
    expect(low.verdict).toBe("invest");
    expect(
      paydownVsInvest({
        balanceCents: 18_200_000,
        rateBps: 550,
        paymentCents: 112_000,
        extraMonthlyCents: 50_000,
      }).verdict,
    ).toBe("close");
  });
});
