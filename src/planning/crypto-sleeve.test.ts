import { describe, expect, it } from "vitest";
import { CRYPTO_SLEEVE_MIN_TRADE_CENTS } from "@/config/crypto-strategies";
import { cryptoSleeveTrades, previousWeekday, sleeveCash, sleeveDecides } from "./crypto-sleeve";
import type { LedgerState } from "./practice-ledger";

// The crypto sleeve in the practice portfolio: the menu's own rule, on its own days, within its
// share of the whole portfolio, never spending cash it doesn't have, and sold whole when it's
// off or the level isn't Very high.

const up = Array.from({ length: 260 }, (_, k) => 10_000 + k * 50);
const down = Array.from({ length: 260 }, (_, k) => 30_000 - k * 50);
const prices = { BTCUSD: up.at(-1)!, ETHUSD: down.at(-1)!, VTI: 20_000 };
const cash = (cents: number): LedgerState => ({ cashCents: cents, positions: {} });
const base = {
  level: 5 as const,
  prices,
  history: { BTCUSD: up, ETHUSD: down },
  today: "2026-10-19",
  previous: "2026-10-16",
  traded: true,
};

describe("cryptoSleeveTrades", () => {
  it("buys the rule's coins up to the sleeve's share of the whole portfolio", () => {
    const trades = cryptoSleeveTrades({
      ...base,
      sleeve: { strategy: "crypto_trend", param: 50, share: 0.05 },
      state: cash(1_000_000),
      cashCents: 1_000_000,
    });
    // Bitcoin is above its average, ether below: half the sleeve in bitcoin, none in ether.
    expect(trades).toEqual([
      expect.objectContaining({ ticker: "BTCUSD", side: "buy", amountCents: 25_000 }),
    ]);
    expect(trades[0].reason).toMatch(/bitcoin is above its 50-day average/);
    expect(trades[0].rule).toBe("crypto_sleeve");
  });

  it("momentum puts the whole sleeve in the coin that rose, held: half and half", () => {
    const m = cryptoSleeveTrades({
      ...base,
      sleeve: { strategy: "crypto_momentum", param: 30, share: 0.05 },
      state: cash(1_000_000),
      cashCents: 1_000_000,
    });
    expect(m.map((t) => [t.ticker, t.amountCents])).toEqual([["BTCUSD", 50_000]]);
    const h = cryptoSleeveTrades({
      ...base,
      sleeve: { strategy: "crypto_hold", param: 0, share: 0.05 },
      state: cash(1_000_000),
      cashCents: 1_000_000,
      traded: false,
    });
    expect(h.map((t) => [t.ticker, t.amountCents])).toEqual([
      ["BTCUSD", 25_000],
      ["ETHUSD", 25_000],
    ]);
  });

  it("decides only on its own days once it holds coins", () => {
    const state: LedgerState = {
      cashCents: 975_000,
      positions: { ETHUSD: { quantity: 25_000 / prices.ETHUSD, costBasisCents: 25_000 } },
    };
    const sleeve = { strategy: "crypto_trend" as const, param: 50, share: 0.05 };
    // A Wednesday: the week already decided.
    const midweek = { ...base, today: "2026-10-21", previous: "2026-10-20" };
    expect(cryptoSleeveTrades({ ...midweek, sleeve, state, cashCents: 975_000 })).toEqual([]);
    // Before its first trade it starts on any day.
    expect(
      cryptoSleeveTrades({ ...midweek, traded: false, sleeve, state, cashCents: 975_000 }),
    ).not.toEqual([]);
    // Monday: ether is below its average, so it is sold, and bitcoin bought with what it frees.
    const monday = cryptoSleeveTrades({ ...base, sleeve, state, cashCents: 0 });
    expect(monday.map((t) => [t.ticker, t.side])).toEqual([
      ["ETHUSD", "sell"],
      ["BTCUSD", "buy"],
    ]);
    expect(monday[1].amountCents).toBeLessThanOrEqual(25_000);
    expect(sleeveCash(monday)).toBeGreaterThanOrEqual(0);
  });

  it("never spends cash it doesn't have, and skips dust", () => {
    const t = cryptoSleeveTrades({
      ...base,
      sleeve: { strategy: "crypto_hold", param: 0, share: 0.05 },
      state: cash(1_000_000),
      cashCents: CRYPTO_SLEEVE_MIN_TRADE_CENTS - 1,
    });
    expect(t).toEqual([]);
  });

  it("sells everything when off, or below Very high", () => {
    const state: LedgerState = {
      cashCents: 0,
      positions: { BTCUSD: { quantity: 2, costBasisCents: 20_000 } },
    };
    const off = cryptoSleeveTrades({ ...base, sleeve: null, state, cashCents: 0 });
    expect(off).toEqual([
      expect.objectContaining({ ticker: "BTCUSD", side: "sell", amountCents: 2 * prices.BTCUSD }),
    ]);
    expect(off[0].reason).toMatch(/the crypto sleeve is off/);
    const low = cryptoSleeveTrades({ ...base, level: 3, sleeve: null, state, cashCents: 0 });
    expect(low[0].reason).toMatch(/runs at Very high only/);
  });

  it("waits without a price or enough history", () => {
    const sleeve = { strategy: "crypto_trend" as const, param: 200, share: 0.05 };
    const short = { BTCUSD: up.slice(-100), ETHUSD: down.slice(-100) };
    expect(
      cryptoSleeveTrades({ ...base, sleeve, history: short, state: cash(1e6), cashCents: 1e6 }),
    ).toEqual([]);
    expect(
      cryptoSleeveTrades({
        ...base,
        prices: { VTI: 20_000 },
        sleeve,
        state: cash(1e6),
        cashCents: 1e6,
      }),
    ).toEqual([]);
  });
});

describe("the sleeve's days", () => {
  it("weekly rules decide on a week's first trading day, held on a month's", () => {
    expect(sleeveDecides("crypto_trend", "2026-10-19", "2026-10-16")).toBe(true);
    expect(sleeveDecides("crypto_trend", "2026-10-20", "2026-10-19")).toBe(false);
    // Monday a holiday: Tuesday decides.
    expect(sleeveDecides("crypto_momentum", "2026-10-20", "2026-10-16")).toBe(true);
    expect(sleeveDecides("crypto_hold", "2026-11-02", "2026-10-30")).toBe(true);
    expect(sleeveDecides("crypto_hold", "2026-10-19", "2026-10-16")).toBe(false);
    expect(previousWeekday("2026-10-19")).toBe("2026-10-16");
    expect(previousWeekday("2026-10-21")).toBe("2026-10-20");
  });
});
