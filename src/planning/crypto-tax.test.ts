import { describe, expect, it } from "vitest";
import { lotsAndSales, salesIn, totals, unrealised, type Trade } from "./crypto-tax";

// Spec step 219: crypto gains by lot (first in, first out), short- and long-term by the
// holding period.

const buy = (date: string, quantity: number, cents: number): Trade => ({
  date,
  asset: "BTC",
  side: "buy",
  quantity,
  cents,
});
const sell = (date: string, quantity: number, cents: number): Trade => ({
  date,
  asset: "BTC",
  side: "sell",
  quantity,
  cents,
});

describe("crypto lots and sales", () => {
  it("sells the oldest lot first, long-term after more than a year", () => {
    const { sales, left } = lotsAndSales(
      "BTC",
      [
        buy("2024-01-10", 1, 4_000_000),
        buy("2025-06-01", 1, 6_000_000),
        sell("2026-03-01", 1, 9_000_000),
      ],
      1,
      null,
    );
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      costCents: 4_000_000,
      gainCents: 5_000_000,
      longTermCents: 5_000_000,
      shortTermCents: 0,
    });
    expect(left).toEqual([{ date: "2025-06-01", quantity: 1, costCents: 6_000_000 }]);
  });

  it("splits a sale across lots, part long-term and part short-term", () => {
    const { sales } = lotsAndSales(
      "BTC",
      [
        buy("2024-01-10", 1, 4_000_000),
        buy("2025-12-01", 1, 8_000_000),
        sell("2026-03-01", 2, 20_000_000),
      ],
      0,
      null,
    );
    // Half the coins are long-term: proceeds 10,000,000 against cost 4,000,000; the other
    // half short-term: 10,000,000 against 8,000,000.
    expect(sales[0]).toMatchObject({
      gainCents: 8_000_000,
      longTermCents: 6_000_000,
      shortTermCents: 2_000_000,
    });
  });

  it("holds exactly a year as short-term, a day more as long-term", () => {
    const one = (soldOn: string) =>
      lotsAndSales("BTC", [buy("2025-03-01", 1, 1_000_000), sell(soldOn, 1, 2_000_000)], 0, null)
        .sales[0];
    expect(one("2026-03-01").shortTermCents).toBe(1_000_000);
    expect(one("2026-03-02").longTermCents).toBe(1_000_000);
  });

  it("counts coins from before the history as one long-term opening lot at the reported basis", () => {
    const { sales, left } = lotsAndSales(
      "BTC",
      [sell("2026-02-01", 0.5, 3_000_000)],
      1.5,
      4_000_000,
    );
    // 2 coins before the sale, bought at 4,000,000 in all: 0.5 sold costs 1,000,000.
    expect(left[0]).toMatchObject({ date: null, quantity: 1.5 });
    expect(sales[0]).toMatchObject({
      costCents: 1_000_000,
      gainCents: 2_000_000,
      longTermCents: 2_000_000,
    });
    // The basis of what's left is what the sale didn't use.
    expect(Math.round(left[0].costCents)).toBe(3_000_000);
  });

  it("makes a loss a loss, and totals the year's sales", () => {
    const { sales } = lotsAndSales(
      "BTC",
      [
        buy("2025-01-01", 1, 5_000_000),
        sell("2026-05-01", 1, 3_000_000),
        buy("2026-06-01", 1, 1_000_000),
        sell("2026-07-01", 1, 1_500_000),
      ],
      0,
      null,
    );
    expect(sales.map((s) => s.gainCents)).toEqual([-2_000_000, 500_000]);
    expect(totals(salesIn(sales, 2026))).toEqual({
      proceedsCents: 4_500_000,
      costCents: 6_000_000,
      shortTermCents: 500_000,
      longTermCents: -2_000_000,
    });
    expect(salesIn(sales, 2025)).toEqual([]);
  });

  it("splits an unrealised gain by the lots left", () => {
    const { left } = lotsAndSales(
      "BTC",
      [buy("2024-01-10", 1, 4_000_000), buy("2026-06-01", 1, 8_000_000)],
      2,
      null,
    );
    expect(unrealised(20_000_000, left, "2026-10-18")).toEqual({
      basisCents: 12_000_000,
      gainCents: 8_000_000,
      shortTermCents: 4_000_000,
      longTermCents: 4_000_000,
    });
  });
});
