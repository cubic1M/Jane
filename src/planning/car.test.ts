import { describe, expect, it } from "vitest";
import type { LoanOffer } from "@/lib/lenders/partner";
import {
  carCosts,
  compareCarOffers,
  dealerCheck,
  insuranceYearlyCents,
  maxAffordablePrice,
} from "./car";

const offer = (id: string, aprBps: number, feeCents = 0, termMonths = 60): LoanOffer => ({
  id,
  lender: id,
  product: "auto",
  aprBps,
  rateType: "fixed",
  termMonths,
  feeCents,
  feeLabel: feeCents ? "A fee" : "No fees",
  sourceUrl: "https://example.com",
  demo: true,
});

describe("insurance for a car's price", () => {
  it("scales the current premium by price over the current car's value, softly", () => {
    const current = { yearlyCents: 144_000, carValueCents: 2_500_000 };
    expect(insuranceYearlyCents(2_500_000, current)).toBe(144_000);
    // Twice the price: premium up by the square root of two.
    expect(insuranceYearlyCents(5_000_000, current)).toBe(Math.round(144_000 * Math.SQRT2));
  });
  it("uses a share of the price when there's no policy", () => {
    expect(insuranceYearlyCents(3_000_000, null)).toBe(120_000);
  });
});

describe("what a car costs a month, all in", () => {
  it("adds the loan payment, insurance, fuel, upkeep and registration", () => {
    const c = carCosts({
      priceCents: 3_000_000,
      downCents: 300_000,
      termMonths: 60,
      aprBps: 549,
      insuranceYearlyCents: 144_000,
      fuelMonthlyCents: 12_000,
    });
    expect(c.financedCents).toBe(2_700_000);
    expect(c.paymentCents).toBeGreaterThan(50_000);
    expect(c.paymentCents).toBeLessThan(54_000);
    expect(c.insuranceCents).toBe(12_000);
    expect(c.maintenanceCents).toBe(3_750);
    expect(c.registrationCents).toBe(2_000);
    expect(c.allInCents).toBe(c.paymentCents + 12_000 + 12_000 + 3_750 + 2_000);
    expect(c.loanTotalCents).toBeGreaterThan(2_700_000);
  });
});

describe("the most car a person can afford", () => {
  const base = {
    downShare: 0.1,
    termMonths: 60,
    aprBps: 549,
    insuranceYearlyFor: (p: number) => Math.round(p * 0.04),
    fuelMonthlyCents: 12_000,
  };
  it("is the highest price whose all-in cost fits 20% of income", () => {
    const max = maxAffordablePrice({ ...base, monthlyIncomeCents: 600_000 });
    const cost = (price: number) =>
      carCosts({
        priceCents: price,
        downCents: Math.round(price * 0.1),
        termMonths: 60,
        aprBps: 549,
        insuranceYearlyCents: Math.round(price * 0.04),
        fuelMonthlyCents: 12_000,
      }).allInCents;
    expect(cost(max)).toBeLessThanOrEqual(120_000);
    expect(cost(max + 50_000)).toBeGreaterThan(120_000);
  });
  it("is nothing when even fuel eats the allowance", () => {
    expect(maxAffordablePrice({ ...base, monthlyIncomeCents: 50_000 })).toBe(0);
  });
});

describe("offers and the dealer", () => {
  it("compares by total cost with the fee in, at the same term, cheapest first", () => {
    const scored = compareCarOffers(
      [
        offer("cheap-rate-big-fee", 519, 29_900),
        offer("plain", 549),
        offer("other-term", 400, 0, 72),
      ],
      2_000_000,
      60,
    );
    // The lower rate's $299 fee costs more than the rate saves on this loan.
    expect(scored.map((s) => s.offer.id)).toEqual(["plain", "cheap-rate-big-fee"]);
    expect(scored[0].totalCents).toBeLessThan(scored[1].totalCents);
  });
  it("flags a dealer rate well above the best offer, and not one that costs less", () => {
    const [best] = compareCarOffers([offer("plain", 549)], 2_000_000, 60);
    const worse = dealerCheck({ aprBps: 799, termMonths: 60, feesCents: 0 }, 2_000_000, best, 100);
    expect(worse.verdict).toBe("worse");
    expect(worse.extraCents).toBeGreaterThan(0);
    expect(worse.extraBps).toBe(250);
    const close = dealerCheck({ aprBps: 580, termMonths: 60, feesCents: 0 }, 2_000_000, best, 100);
    expect(close.verdict).toBe("similar");
    const better = dealerCheck({ aprBps: 399, termMonths: 60, feesCents: 0 }, 2_000_000, best, 100);
    expect(better.verdict).toBe("better");
    expect(better.extraCents).toBeLessThan(0);
  });
  it("counts the dealer's fees", () => {
    const [best] = compareCarOffers([offer("plain", 549)], 2_000_000, 60);
    const fee = dealerCheck(
      { aprBps: 549, termMonths: 60, feesCents: 80_000 },
      2_000_000,
      best,
      100,
    );
    expect(fee.extraCents).toBe(80_000);
  });
});
