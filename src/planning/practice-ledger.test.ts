import { describe, expect, it } from "vitest";
import {
  apply,
  balances,
  LedgerError,
  replay,
  value,
  type Entry,
  type LedgerState,
} from "./practice-ledger";

const ALLOWED = new Set(["VTI", "BND"]);
const START: LedgerState = { cashCents: 1_000_000, positions: {} };

describe("the practice ledger", () => {
  it("buys with cash and sells back, with the gain against what was paid", () => {
    const bought = apply(
      START,
      { side: "buy", ticker: "VTI", amountCents: 500_000, priceCents: 25_000 },
      ALLOWED,
    );
    expect(bought.state.cashCents).toBe(500_000);
    expect(bought.quantity).toBe(20);
    const sold = apply(
      bought.state,
      { side: "sell", ticker: "VTI", amountCents: 300_000, priceCents: 30_000 },
      ALLOWED,
    );
    // 10 shares bought at 250, sold at 300: a gain of 500 dollars.
    expect(sold.quantity).toBe(10);
    expect(sold.gainCents).toBe(50_000);
    expect(sold.state.cashCents).toBe(800_000);
    expect(sold.state.positions.VTI).toEqual({ quantity: 10, costBasisCents: 250_000 });
  });

  it("allows no borrowing, no selling short, no unknown tickers and no odd amounts", () => {
    expect(() =>
      apply(
        START,
        { side: "buy", ticker: "VTI", amountCents: 1_000_001, priceCents: 100 },
        ALLOWED,
      ),
    ).toThrow(LedgerError);
    expect(() =>
      apply(START, { side: "sell", ticker: "VTI", amountCents: 100, priceCents: 100 }, ALLOWED),
    ).toThrow(/short/);
    expect(() =>
      apply(
        START,
        { side: "buy", ticker: "SPY240621C", amountCents: 100, priceCents: 100 },
        ALLOWED,
      ),
    ).toThrow(/isn't something/);
    expect(() => apply(START, { side: "deposit", amountCents: 10.5 }, ALLOWED)).toThrow(
      LedgerError,
    );
    expect(() => apply(START, { side: "deposit", amountCents: 0 }, ALLOWED)).toThrow(LedgerError);
  });

  it("closes a position cleanly when everything is sold", () => {
    const b = apply(
      START,
      { side: "buy", ticker: "BND", amountCents: 333_333, priceCents: 7_777 },
      ALLOWED,
    ).state;
    const q = b.positions.BND.quantity;
    const s = apply(
      b,
      { side: "sell", ticker: "BND", amountCents: Math.round(q * 7_777), priceCents: 7_777 },
      ALLOWED,
    );
    expect(s.state.positions.BND).toBeUndefined();
    expect(s.gainCents).toBe(s.state.cashCents - 1_000_000);
  });

  it("balances to the cent after any run of trades, and can be rebuilt from them", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let state = START;
    const entries: Entry[] = [];
    for (let i = 0; i < 400; i += 1) {
      const price = 5_000 + Math.floor(rand() * 20_000);
      const ticker = rand() < 0.5 ? "VTI" : "BND";
      const r = rand();
      let entry: Entry;
      if (r < 0.15) entry = { side: "deposit", amountCents: 1 + Math.floor(rand() * 100_000) };
      else if (r < 0.6)
        entry = {
          side: "buy",
          ticker,
          amountCents: 1 + Math.floor(rand() * Math.max(1, state.cashCents)),
          priceCents: price,
        };
      else {
        const held = state.positions[ticker];
        if (!held) continue;
        entry = {
          side: "sell",
          ticker,
          amountCents: Math.max(1, Math.round(held.quantity * price * rand())),
          priceCents: price,
        };
      }
      try {
        state = apply(state, entry, ALLOWED).state;
        entries.push(entry);
      } catch {
        // A refused trade changes nothing.
      }
    }
    expect(entries.length).toBeGreaterThan(100);
    expect(state.cashCents).toBeGreaterThanOrEqual(0);
    expect(balances(1_000_000, entries, state)).toBe(true);
    expect(replay(1_000_000, entries, ALLOWED)).toEqual(state);
  });

  it("values the portfolio at the day's prices", () => {
    const s = apply(
      START,
      { side: "buy", ticker: "VTI", amountCents: 500_000, priceCents: 25_000 },
      ALLOWED,
    ).state;
    expect(value(s, { VTI: 30_000 })).toBe(500_000 + 600_000);
  });
});
