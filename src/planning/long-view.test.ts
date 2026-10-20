import { describe, expect, it } from "vitest";
import { levers, longView, type LongViewInput, type Rates } from "./long-view";

// Spec step 209, pure: net worth at 10, 20 and 30 years as a range from the low to the high
// return, with the growth rates handed in.

const rates: Rates = { investedLow: 0.04, investedHigh: 0.08, cash: 0, home: 0.01 };
const base: LongViewInput = {
  cashCents: 1_000_000,
  investedCents: 5_000_000,
  growingAssetsCents: 30_000_000,
  otherAssetsCents: 1_500_000,
  debts: [],
  marginCents: 0,
  investMonthlyCents: 0,
};
const monthly = (yearly: number) => Math.pow(1 + yearly, 1 / 12) - 1;

describe("longView", () => {
  it("grows invested money at the low and high rates, leaving the rest alone", () => {
    const [ten] = longView(base, rates);
    const low = 5_000_000 * Math.pow(1 + monthly(0.04), 120);
    const high = 5_000_000 * Math.pow(1 + monthly(0.08), 120);
    const home = 30_000_000 * Math.pow(1 + monthly(0.01), 120);
    expect(ten.years).toBe(10);
    expect(ten.lowCents).toBe(Math.round(1_000_000 + low + home + 1_500_000));
    expect(ten.highCents).toBe(Math.round(1_000_000 + high + home + 1_500_000));
    expect(ten.highCents).toBeGreaterThan(ten.lowCents);
  });

  it("adds each month's investing as an annuity", () => {
    const input = {
      ...base,
      investedCents: 0,
      cashCents: 0,
      growingAssetsCents: 0,
      otherAssetsCents: 0,
      marginCents: 100_000,
      investMonthlyCents: 100_000,
    };
    const [ten] = longView(input, rates);
    const m = monthly(0.04);
    const annuity = (100_000 * (Math.pow(1 + m, 120) - 1)) / m;
    // Contributions are added after the month's growth, so the first month earns nothing.
    expect(Math.abs(ten.lowCents - annuity)).toBeLessThan(annuity * 0.02);
  });

  it("puts what isn't invested in cash and leaves nothing negative", () => {
    const input = { ...base, marginCents: 50_000, investMonthlyCents: 20_000 };
    const [ten] = longView(input, rates);
    expect(ten.parts.cashCents).toBe(1_000_000 + 120 * 30_000);
    const broke = longView({ ...base, marginCents: -20_000 }, rates)[0];
    expect(broke.parts.cashCents).toBe(1_000_000);
  });

  it("pays a debt down by its payment, and invests that payment once it's gone", () => {
    const input: LongViewInput = {
      ...base,
      investedCents: 0,
      growingAssetsCents: 0,
      otherAssetsCents: 0,
      cashCents: 0,
      debts: [
        {
          name: "Card",
          balanceCents: 300_000,
          aprBps: 2_000,
          paymentCents: 30_000,
          fromMargin: true,
        },
      ],
      marginCents: 30_000,
      investMonthlyCents: 0,
    };
    const horizons = longView(input, rates);
    expect(horizons[0].parts.debtsCents).toBe(0);
    // Paid off in about 11 months; after that its payment is invested.
    expect(horizons[0].parts.investedLowCents).toBeGreaterThan(30_000 * 100);
    // Without the payment going anywhere the debt would stay (interest only).
    const stuck = longView(
      { ...input, debts: [{ ...input.debts[0], paymentCents: null }] },
      rates,
    )[0];
    expect(stuck.parts.debtsCents).toBeGreaterThan(300_000);
  });

  it("ranks what moves the 30-year low end most", () => {
    const input: LongViewInput = {
      ...base,
      debts: [
        {
          name: "Card",
          balanceCents: 600_000,
          aprBps: 2_400,
          paymentCents: 20_000,
          fromMargin: true,
        },
      ],
      marginCents: 150_000,
      investMonthlyCents: 50_000,
    };
    const ranked = levers(input, rates, 10_000);
    expect(ranked.map((l) => l.key).sort()).toEqual(["debt:Card", "invest"]);
    expect(ranked[0].deltaCents).toBeGreaterThanOrEqual(ranked[1].deltaCents);
    expect(ranked.every((l) => l.deltaCents !== 0)).toBe(true);
  });
});
