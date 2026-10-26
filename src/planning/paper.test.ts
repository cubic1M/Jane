import { describe, expect, it } from "vitest";
import { fill, holdUnits, holdValue, mixWeights, ordersToward, revert, value } from "./paper";
import type { LedgerState } from "./practice-ledger";

// The paper account's arithmetic: trades toward a strategy's targets, filled and reverted to the
// cent, and just holding the level's mix to compare with.

const prices = { VTI: 25_000, BND: 7_500, BIL: 9_150, VXUS: 6_000 };
const empty = (cash: number): LedgerState => ({ cashCents: cash, positions: {} });
const opts = { band: 0.02, minTradeCents: 2_500 };

describe("trades toward the targets", () => {
  it("buys into the targets from cash, biggest first, never more than the cash", () => {
    const orders = ordersToward({ VTI: 0.6, BND: 0.4 }, empty(1_000_000), prices, opts);
    expect(orders).toEqual([
      { ticker: "VTI", side: "buy", amountCents: 600_000 },
      { ticker: "BND", side: "buy", amountCents: 400_000 },
    ]);
    // Asked for more than there is: the cash caps it.
    const over = ordersToward({ VTI: 0.9, BND: 0.9 }, empty(100_000), prices, opts);
    expect(over.reduce((a, o) => a + o.amountCents, 0)).toBe(100_000);
  });

  it("sells first: what the targets don't hold, and what's over its share by more than the band", () => {
    const state: LedgerState = {
      cashCents: 0,
      positions: {
        VTI: { quantity: 40, costBasisCents: 1_000_000 }, // $10,000
        BIL: { quantity: 10, costBasisCents: 91_500 }, // $915
      },
    };
    const orders = ordersToward({ VTI: 0.5, BND: 0.5 }, state, prices, opts);
    expect(orders.map((o) => `${o.side} ${o.ticker}`)).toEqual(["sell BIL", "sell VTI", "buy BND"]);
    expect(orders[0].amountCents).toBe(91_500);
    // The buy spends exactly what the sells freed.
    expect(orders[2].amountCents).toBe(orders[0].amountCents + orders[1].amountCents);
  });

  it("leaves a fund alone inside the band, or with no price", () => {
    const state: LedgerState = {
      cashCents: 0,
      positions: {
        VTI: { quantity: 24.4, costBasisCents: 0 }, // $6,100 of $10,000: 1 point over
        BND: { quantity: 52, costBasisCents: 0 }, // $3,900
      },
    };
    expect(ordersToward({ VTI: 0.6, BND: 0.4 }, state, prices, opts)).toEqual([]);
    expect(ordersToward({ XYZ: 1 }, empty(10_000), prices, opts)).toEqual([]);
  });
});

describe("filling and reverting", () => {
  it("fills by the ledger's rules: no borrowing, no shorting", () => {
    const a = fill(empty(100_000), { ticker: "VTI", side: "buy", amountCents: 50_000 }, 25_000);
    expect(a.state.cashCents).toBe(50_000);
    expect(a.quantity).toBe(2);
    expect(() =>
      fill(empty(100), { ticker: "VTI", side: "buy", amountCents: 50_000 }, 25_000),
    ).toThrow(/Not enough cash/);
    expect(() =>
      fill(empty(100_000), { ticker: "VTI", side: "sell", amountCents: 50_000 }, 25_000),
    ).toThrow(/no selling short/);
  });

  it("a revert puts the cash and the shares back exactly", () => {
    const start: LedgerState = {
      cashCents: 30_000,
      positions: { VTI: { quantity: 4, costBasisCents: 90_000 } },
    };
    for (const side of ["buy", "sell"] as const) {
      const order = { ticker: "VTI", side, amountCents: 25_000 };
      const after = fill(start, order, 25_000).state;
      const back = revert(after, { ...order, priceCents: 25_000 }).state;
      expect(back.cashCents).toBe(start.cashCents);
      expect(back.positions.VTI.quantity).toBeCloseTo(4, 9);
      expect(value(back, prices)).toBe(value(start, prices));
    }
  });
});

describe("just holding", () => {
  it("is the level's mix bought at the start and never traded", () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const w = mixWeights(level);
      expect(Object.values(w).reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9);
      const units = holdUnits(level, 1_000_000, prices);
      expect(holdValue(units, prices)).toBeGreaterThanOrEqual(999_990);
    }
    const units = holdUnits(3, 1_000_000, prices);
    const up = { ...prices, VTI: prices.VTI * 1.1 };
    expect(holdValue(units, up)).toBeGreaterThan(holdValue(units, prices));
  });
});
