import { describe, expect, it } from "vitest";
import { CLASSES, locationPlan, targets, type Class, type PlanAccount } from "./location";

// Spec step 231: one allocation across every account; the overall mix never changes.

const H = (
  ticker: string,
  valueCents: number,
  moveClass: Class | null,
  gainCents: number | null = 0,
) => ({
  ticker,
  name: ticker,
  valueCents,
  moveClass,
  gainCents,
});
const RATES = {
  yieldBps: { bonds: 380, us_stocks: 170, intl_stocks: 290 },
  payoutRate: { bonds: 0.22, us_stocks: 0.15, intl_stocks: 0.15 },
  gainRate: 0.15,
};

// A 401(k) of US stocks, a Roth of US stocks, and a taxable account full of bonds.
const ACCOUNTS: PlanAccount[] = [
  { id: "k", name: "401(k)", kind: "pre_tax", holdings: [H("KTSIX", 10_000_000, "us_stocks")] },
  { id: "r", name: "Roth IRA", kind: "roth", holdings: [H("KTSIX", 5_000_000, "us_stocks")] },
  {
    id: "t",
    name: "Brokerage",
    kind: "taxable",
    holdings: [H("KTBIX", 10_000_000, "bonds", 1_000_000)],
  },
];

describe("locationPlan", () => {
  it("puts bonds in the 401(k) and stocks in taxable and Roth, swapping equal amounts", () => {
    const p = locationPlan({ accounts: ACCOUNTS, ...RATES });
    expect(p.after.k).toEqual({ bonds: 10_000_000, us_stocks: 0, intl_stocks: 0 });
    expect(p.after.t).toEqual({ bonds: 0, us_stocks: 10_000_000, intl_stocks: 0 });
    expect(p.after.r).toEqual({ bonds: 0, us_stocks: 5_000_000, intl_stocks: 0 });
    expect(p.swaps).toHaveLength(1);
    expect(p.swaps[0]).toMatchObject({ amountCents: 10_000_000 });
    // The taxable sale is of bonds with a 10% gain: $10,000 gain, $1,500 tax, shown.
    expect(p.swaps[0].gainCents).toBe(1_000_000);
    expect(p.swaps[0].taxCents).toBe(150_000);
  });

  it("keeps the overall mix exactly the same, before and after", () => {
    const p = locationPlan({ accounts: ACCOUNTS, ...RATES });
    for (const c of CLASSES) {
      const after = Object.values(p.after).reduce((s, a) => s + a[c], 0);
      expect(after).toBe(p.totals[c]);
    }
    expect(p.totals).toEqual({ bonds: 10_000_000, us_stocks: 15_000_000, intl_stocks: 0 });
  });

  it("figures the yearly tax saved: bond interest at 22% gone, dividends at 15% added", () => {
    const p = locationPlan({ accounts: ACCOUNTS, ...RATES });
    // Before: $100,000 of bonds at 3.8% taxed at 22% = $836.00. After: $100,000 of stocks at 1.7% at 15% = $255.00.
    expect(p.taxNowCents).toBe(83_600);
    expect(p.taxAfterCents).toBe(25_500);
    expect(p.savedCents).toBe(58_100);
  });

  it("leaves target-date and cash funds where they are, and does nothing when it is already right", () => {
    const placed: PlanAccount[] = [
      {
        id: "k",
        name: "401(k)",
        kind: "pre_tax",
        holdings: [H("KTBIX", 10_000_000, "bonds"), H("NSTDX", 5_000_000, null)],
      },
      {
        id: "t",
        name: "Brokerage",
        kind: "taxable",
        holdings: [H("KTSIX", 10_000_000, "us_stocks")],
      },
    ];
    const p = locationPlan({ accounts: placed, ...RATES });
    expect(p.swaps).toEqual([]);
    expect(p.savedCents).toBe(0);
  });

  it("holds the invariant for any mix of accounts", () => {
    const kinds = ["pre_tax", "roth", "taxable"] as const;
    for (let seed = 1; seed <= 25; seed += 1) {
      const rnd = (n: number) => ((seed * 7919 + n * 104729) % 1000) / 1000;
      const accounts: PlanAccount[] = kinds.map((kind, i) => ({
        id: kind,
        name: kind,
        kind,
        holdings: CLASSES.map((c, j) =>
          H(c, Math.round(rnd(i * 3 + j) * 9_000_000), c, Math.round(rnd(j) * 500_000)),
        ),
      }));
      const p = locationPlan({ accounts, ...RATES });
      for (const c of CLASSES) {
        expect(Object.values(p.after).reduce((s, a) => s + a[c], 0)).toBe(p.totals[c]);
      }
      // Every account keeps the same total value of its movable money.
      for (const a of accounts) {
        expect(CLASSES.reduce((s, c) => s + p.after[a.id][c], 0)).toBe(
          CLASSES.reduce((s, c) => s + p.before[a.id][c], 0),
        );
      }
      void targets;
    }
  });
});
