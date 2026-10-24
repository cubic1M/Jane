import { describe, expect, it } from "vitest";
import { INTRADAY_SLIPPAGE } from "@/config/intraday-strategies";
import type { IntradayBar } from "@/lib/market/types";
import { dayTradeFills, dayTradeReserve } from "./day-trade";
import { sessionsOf, type Session } from "./intraday";

// The day-trading sleeve in the practice portfolio: the menu's own rule on the day's bars, in and
// out the same day at those bars' prices with the slippage both ways, with the sleeve's share
// of the portfolio and never more cash than it has.

function session(day: string, at: Record<number, Partial<IntradayBar>> = {}, then = 10_000) {
  const open = Date.parse(`${day}T14:30:00Z`);
  const bars = Array.from({ length: 78 }, (_, i) => {
    const p = i >= 7 ? then : 10_000;
    return {
      t: new Date(open + i * 300_000).toISOString(),
      o: p,
      h: p + 1,
      l: p - 1,
      c: p,
      v: 1000,
      ...at[i],
    };
  });
  return sessionsOf(bars)[0] as Session;
}

const sleeve = { rule: "opening_range" as const, param: 30, share: 0.05 };

describe("dayTradeFills", () => {
  it("buys at the rule's entry and sells at its exit, slippage both ways", () => {
    const today = session("2024-01-10", { 6: { c: 10_010, h: 10_010 }, 20: { h: 10_040 } }, 10_010);
    const [buy, sell] = dayTradeFills({
      sleeve,
      today,
      prior: null,
      portfolioCents: 1_000_000,
      cashCents: 100_000,
    });
    expect(buy).toMatchObject({
      ticker: "SPY",
      side: "buy",
      amountCents: 50_000,
      priceCents: Math.round(10_010 * (1 + INTRADAY_SLIPPAGE)),
      rule: "day_trade",
    });
    expect(sell).toMatchObject({
      side: "sell",
      priceCents: Math.round(10_032 * (1 - INTRADAY_SLIPPAGE)),
    });
    expect(sell.amountCents).toBe(Math.round((50_000 * sell.priceCents) / buy.priceCents));
    expect(sell.reason).toMatch(/at its target, up \$/);
    expect(sell.reason).toMatch(/Most people who day trade lose money/);
  });

  it("uses no more cash than it has, and nothing when the rule doesn't trade", () => {
    const today = session("2024-01-10", { 6: { c: 10_010, h: 10_010 } }, 10_010);
    const fills = dayTradeFills({
      sleeve,
      today,
      prior: null,
      portfolioCents: 1e6,
      cashCents: 20_000,
    });
    expect(fills[0].amountCents).toBe(20_000);
    expect(
      dayTradeFills({ sleeve, today, prior: null, portfolioCents: 1e6, cashCents: 0 }),
    ).toEqual([]);
    const quiet = session("2024-01-10");
    expect(
      dayTradeFills({ sleeve, today: quiet, prior: null, portfolioCents: 1e6, cashCents: 1e6 }),
    ).toEqual([]);
    expect(
      dayTradeFills({ sleeve, today: null, prior: null, portfolioCents: 1e6, cashCents: 1e6 }),
    ).toEqual([]);
  });

  it("keeps the sleeve's share in cash, and none when it's off", () => {
    expect(dayTradeReserve(sleeve, 1_000_000)).toBe(50_000);
    expect(dayTradeReserve(null, 1_000_000)).toBe(0);
  });
});
