import { describe, expect, it } from "vitest";
import { EVENT_TILT_BY_LEVEL, EVENT_TYPES, eventTypesFor } from "@/config/events";
import { eventAgentSignals } from "./event-agent-signals";
import { classifyText, hourlySpikes, knownBy, type Coverage } from "./event-detect";
import { runAgent, startState } from "./trading-agent/engine";
import type { AgentBar, Policy } from "./trading-agent/types";

// The crypto events (founder, 2026-10-26): mapped to bitcoin and ether by rules; read hour by hour
// with no lookahead; and through the 24-hour agent, acted on at the next bar after they became
// public, around the clock.

describe("crypto events, by rules", () => {
  it("maps each kind of crypto headline to its type, and ordinary news to none", () => {
    const type = (t: string) => classifyText(t)[0]?.type ?? null;
    expect(type("Crypto exchange halts withdrawals after a $400 million hack")).toBe(
      "crypto_exchange_failure",
    );
    expect(type("SEC approves spot bitcoin ETFs; record inflows on day one")).toBe("crypto_etf");
    expect(type("China announces a crackdown on cryptocurrency trading")).toBe("crypto_regulation");
    expect(type("Stablecoin USDC loses its peg after bank failure")).toBe("stablecoin_depeg");
    expect(type("Bitcoin slides as $1 billion of positions are liquidated")).toBe(
      "crypto_liquidation",
    );
    expect(type("Bitcoin conference opens in Miami")).toBeNull();
  });

  it("are the crypto market's types, trading bitcoin and ether only", () => {
    const crypto = eventTypesFor("crypto");
    expect(crypto).toHaveLength(5);
    for (const t of crypto)
      for (const leg of EVENT_TYPES[t].legs)
        expect(["BTC/USD", "ETH/USD"]).toContain(leg.tickers[0]);
    expect(eventTypesFor("stocks")).not.toContain("crypto_etf");
  });
});

describe("hour-by-hour spikes", () => {
  // Thirty quiet days: 1% of coverage.
  const daily: Coverage[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10),
    count: 1_000,
    total: 100_000,
  }));
  // Oct 31: quiet 15-minute buckets, and a burst from 03:00 to 04:00 (5% of coverage).
  const buckets = Array.from({ length: 24 * 4 }, (_, i) => {
    const at = new Date(Date.UTC(2026, 9, 31, 0, i * 15)).toISOString();
    const burst = at >= "2026-10-31T03:00" && at < "2026-10-31T04:00";
    return { at, count: burst ? 50 : 10, total: 1_000 };
  });

  it("finds the hour, known 15 minutes after it ends", () => {
    const [e, ...rest] = hourlySpikes(
      "crypto_liquidation",
      buckets,
      daily,
      "2026-10-31T12:00:00.000Z",
    );
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      key: "gdelt:crypto_liquidation:2026-10-31",
      date: "2026-10-31",
      knownAt: "2026-10-31T04:15:00.000Z",
      strength: 5,
    });
    expect(e.title).toContain("in the hour to 04:00 UTC");
  });

  it("never judges an hour that hasn't ended, or reads later buckets", () => {
    // At 03:50 the burst's hour hasn't ended: nothing yet.
    expect(hourlySpikes("crypto_liquidation", buckets, daily, "2026-10-31T03:50:00.000Z")).toEqual(
      [],
    );
    // Cutting the buckets off at 04:00 gives the same event as the whole day: nothing later was used.
    const cut = buckets.filter((b) => b.at < "2026-10-31T04:00");
    expect(hourlySpikes("crypto_liquidation", cut, daily, "2026-10-31T04:00:00.000Z")).toEqual(
      hourlySpikes("crypto_liquidation", buckets, daily, "2026-10-31T04:00:00.000Z"),
    );
  });

  it("needs a baseline from the days before, and enough articles", () => {
    expect(hourlySpikes("crypto_liquidation", buckets, [], "2026-10-31T12:00:00.000Z")).toEqual([]);
    const thin = buckets.map((b) => ({ ...b, count: Math.round(b.count / 10) }));
    expect(hourlySpikes("crypto_liquidation", thin, daily, "2026-10-31T12:00:00.000Z")).toEqual([]);
  });
});

describe("crypto events through the 24-hour agent", () => {
  const NO_COSTS = { feeBps: 0, halfSpreadBps: 0, slippageBps: 0 };
  const hours = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, 9, 31, i)).toISOString().replace(".000", ""),
  );
  const bars = (price: number): AgentBar[] =>
    hours.map((t) => ({ t, o: price, h: price, l: price, c: price, v: 1 }));
  // A strategy all in bitcoin from the first bar.
  const policy: Policy = {
    key: "test:btc",
    label: "All bitcoin",
    tickers: ["BTC/USD", "ETH/USD"],
    grid: [0],
    decide: (_tl, t) => (t === 0 ? { "BTC/USD": 1 } : null),
  };
  const config = {
    policy,
    param: 0,
    costs: NO_COSTS,
    cash: "USD",
    master: "BTC/USD",
    session: "24h" as const,
    minutes: 60,
  };

  it("acts at the next bar after the event was public, minutes not a day later, as a tilt", () => {
    const failure = {
      key: "gdelt:crypto_exchange_failure:2026-10-31",
      type: "crypto_exchange_failure" as const,
      source: "gdelt" as const,
      date: "2026-10-31",
      knownAt: "2026-10-31T04:15:00.000Z",
      title: "A crypto exchange fails: news coverage 5.0 times its usual level",
      url: null,
      strength: 5,
    };
    const signals = eventAgentSignals([failure], { level: 5, market: "crypto" });
    const run = runAgent(
      startState(1_000_000),
      { "BTC/USD": bars(6_000_000), "ETH/USD": bars(300_000) },
      signals,
      config,
    );
    const sells = run.trades.filter((t) => t.source === "events");
    // Public at 04:15: the 04:00 bar closes at 05:00, the first close after it; filled at 05:00's
    // open. Nothing before.
    expect(sells.map((t) => [t.at, t.side, t.ticker])).toEqual([
      ["2026-10-31T05:00:00Z", "sell", "BTC/USD"],
    ]);
    expect(knownBy(failure, "2026-10-30")).toBe(false);
    // A trim of the slice to cash: bitcoin from all of the account to all but the slice. (The ether
    // leg changes nothing: the strategy holds no ether.)
    expect(sells[0].amountCents / 1_000_000).toBeCloseTo(EVENT_TILT_BY_LEVEL[5] / 2, 3);
    expect(sells[0].reason).toContain("stops withdrawals");
  });
});
