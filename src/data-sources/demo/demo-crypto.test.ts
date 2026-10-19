import { describe, expect, it } from "vitest";
import { demoCryptoSource } from "@/lib/crypto/source";
import { demoCryptoBalances, demoCryptoTrades } from "./demo-crypto";
import { DEMO_PRICE_PROFILES, demoCryptoPrice, demoPrice } from "./demo-prices";

// Spec step 161: the demo exchange and wallet, read-only.

const ANCHOR = "2026-10-18";
const EVE = "2026-10-17";

describe("the demo exchange and wallet", () => {
  it("hold the demo balances at the demo crypto prices on the anchor's eve", () => {
    const exchange = demoCryptoBalances("exchange", ANCHOR, EVE);
    expect(exchange.map((b) => [b.asset, b.quantity, b.valueCents])).toEqual([
      ["BTC", 0.0425, 285_813],
      ["ETH", 1.3, 339_300],
      ["SOL", 12, 182_880],
      ["USDC", 150, 15_000],
    ]);
    expect(demoCryptoBalances("wallet", ANCHOR, EVE)).toMatchObject([
      { asset: "ETH", quantity: 0.4, valueCents: 104_400 },
    ]);
  });

  it("moves prices from day to day, and keeps USDC at a dollar", () => {
    expect(demoCryptoPrice("BTC", "2026-10-25", ANCHOR)).not.toBe(67_250);
    expect(demoCryptoPrice("USDC", "2026-10-25", ANCHOR)).toBe(1);
  });

  it("buys Bitcoin on the 5th of each month with a $2.24 fee", () => {
    const year = demoCryptoTrades("2025-10-18", "2026-10-17");
    expect(year).toHaveLength(12);
    expect(year.reduce((s, t) => s + t.feeCents, 0)).toBe(2_688);
    expect(year.every((t) => t.side === "buy" && t.amountCents === 15_000)).toBe(true);
  });
});

describe("no order path for crypto", () => {
  it("keeps crypto out of the funds' price feed, so the brokerage can't price it", () => {
    for (const asset of ["BTC", "ETH", "SOL", "USDC"]) {
      expect(DEMO_PRICE_PROFILES[asset]).toBeUndefined();
      expect(demoPrice(asset, EVE, ANCHOR)).toBeNull();
    }
  });

  it("gives a crypto source only ways to read", () => {
    const source = demoCryptoSource(ANCHOR);
    expect(source.readOnly).toBe(true);
    expect(Object.keys(source).sort()).toEqual(["balances", "name", "readOnly", "trades"]);
  });
});
