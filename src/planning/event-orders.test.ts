import { describe, expect, it } from "vitest";
import { closeOrders, openOrders } from "./event-orders";
import { mixWeights } from "./paper";
import type { LedgerState } from "./practice-ledger";

// The paper trades for one events-overlay slice: paid for from cash, then the mix in proportion;
// sells before buys; never more than is held; closing puts the money back into the mix.

const base = mixWeights(3);
const prices = { VTI: 30_000, VXUS: 6_000, BND: 7_000, BIL: 9_100, SMH: 25_000 };
// $10,000 in all: $9,950 in the mix and $50 cash.
const state: LedgerState = {
  cashCents: 5_000,
  positions: {
    VTI: { quantity: 400_000 / 30_000, costBasisCents: 400_000 },
    VXUS: { quantity: 200_000 / 6_000, costBasisCents: 200_000 },
    BND: { quantity: 345_000 / 7_000, costBasisCents: 345_000 },
    BIL: { quantity: 50_000 / 9_100, costBasisCents: 50_000 },
  },
};
const held = (t: string) =>
  Math.floor(state.positions[t].quantity * prices[t as keyof typeof prices]);

describe("an events slice's paper trades", () => {
  it("buys the slice with cash first, then sells the mix in proportion, sells first", () => {
    const orders = openOrders({ ticker: "SMH", side: "buy", tilt: 0.02 }, state, prices, base, 100);
    const buy = orders.at(-1)!;
    expect(buy).toMatchObject({ ticker: "SMH", side: "buy" });
    expect(buy.amountCents).toBe(20_000);
    const sells = orders.slice(0, -1);
    expect(sells.every((o) => o.side === "sell")).toBe(true);
    expect(sells.reduce((a, o) => a + o.amountCents, 0)).toBe(20_000 - 5_000);
    // In proportion to the mix: VTI (40%) gives about twice what VXUS (20%) does.
    const vti = sells.find((o) => o.ticker === "VTI")!.amountCents;
    const vxus = sells.find((o) => o.ticker === "VXUS")!.amountCents;
    expect(vti / vxus).toBeCloseTo(2, 1);
  });

  it("trims at most what is held, into cash, and never shorts", () => {
    const orders = openOrders({ ticker: "BND", side: "trim", tilt: 0.9 }, state, prices, base, 100);
    expect(orders).toEqual([
      { ticker: "BND", side: "sell", amountCents: held("BND") },
      { ticker: "BIL", side: "buy", amountCents: held("BND") },
    ]);
    expect(
      openOrders({ ticker: "XLF", side: "trim", tilt: 0.02 }, state, prices, base, 100),
    ).toEqual([]);
  });

  it("closes by selling the slice's own units and buying the mix back", () => {
    const withSmh: LedgerState = {
      ...state,
      positions: { ...state.positions, SMH: { quantity: 0.8, costBasisCents: 20_000 } },
    };
    const orders = closeOrders(
      { ticker: "SMH", side: "buy", units: 0.8 },
      withSmh,
      prices,
      base,
      100,
    );
    expect(orders[0]).toEqual({ ticker: "SMH", side: "sell", amountCents: 20_000 });
    const buys = orders.slice(1);
    expect(buys.every((o) => o.side === "buy" && o.ticker in base)).toBe(true);
    expect(buys.reduce((a, o) => a + o.amountCents, 0)).toBe(20_000);
    // More units than are held: only what is held is sold.
    const more = closeOrders({ ticker: "SMH", side: "buy", units: 5 }, withSmh, prices, base, 100);
    expect(more[0].amountCents).toBe(20_000);
    // Nothing held, nothing traded.
    expect(closeOrders({ ticker: "SMH", side: "buy", units: 1 }, state, prices, base, 100)).toEqual(
      [],
    );
  });
});
