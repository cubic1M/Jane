import { describe, expect, it } from "vitest";
import {
  EVENT_MAX_EXPOSURE_BY_LEVEL,
  EVENT_STOP,
  EVENT_TILT_BY_LEVEL,
  type EventTypeId,
} from "@/config/events";
import { eventAgentSignals, untilFor } from "./event-agent-signals";
import type { MarketEvent } from "./event-detect";
import { runAgent, startState } from "./trading-agent/engine";
import type { AgentBar, Policy } from "./trading-agent/types";

// The events overlay as the 24-hour agent's signals: the same rules as the overlay (a record at
// least a coin flip, one slice per type, the level's cap), in force from the moment an event was
// public; and run through the agent's own engine, nothing is traded before then.

const event = (
  type: EventTypeId,
  knownAt: string,
  key = `gdelt:${type}:${knownAt}`,
): MarketEvent => ({
  key,
  type,
  source: "gdelt",
  date: knownAt.slice(0, 10),
  knownAt,
  title: "An event",
  url: null,
  strength: 3,
});

describe("events as agent signals", () => {
  it("holds each fund at the overlay's slice from when the event was public, for its holding time", () => {
    const [s] = eventAgentSignals([event("chip_boom", "2026-01-13T00:15:00.000Z")], { level: 3 });
    expect(s).toMatchObject({
      id: "gdelt:chip_boom:2026-01-13T00:15:00.000Z:SMH",
      at: "2026-01-13T00:15:00.000Z",
      ticker: "SMH",
      weight: EVENT_TILT_BY_LEVEL[3],
      tilt: true,
      source: "events",
      stopPct: EVENT_STOP,
    });
    // 20 weekdays after Tuesday the 13th: Tuesday, February 10th, to its end.
    expect(s.until).toBe(untilFor(s.at));
    expect(s.until).toBe("2026-02-10T23:59:59.999Z");
    expect(s.reason).toContain("% sure");
  });

  it("keeps one slice per type at a time, and all of them within the level's cap", () => {
    const one = eventAgentSignals(
      [
        event("chip_boom", "2026-01-13T00:15:00.000Z"),
        event("chip_boom", "2026-01-20T00:15:00.000Z"),
      ],
      { level: 3 },
    );
    expect(one).toHaveLength(1);
    const many = eventAgentSignals(
      (
        ["me_conflict", "war", "chip_boom", "market_panic", "oil_shock", "inflation_hot"] as const
      ).map((t, i) => event(t, `2026-01-1${i + 2}T00:15:00.000Z`)),
      { level: 2 },
    );
    const moved = many.reduce((a, s) => a + Math.abs(s.weight), 0);
    expect(moved).toBeLessThanOrEqual(EVENT_MAX_EXPOSURE_BY_LEVEL[2] + 1e-9);
  });

  it("trims as a tilt to cash, and gives each market its own events", () => {
    const hike = event("fed_hike", "2026-01-13T00:15:00.000Z");
    const stocks = eventAgentSignals([hike], { level: 3 });
    expect(stocks.map((s) => [s.ticker, s.weight])).toEqual([
      ["XLF", 0.01],
      ["BND", -0.01],
    ]);
    // A crypto exchange failing: the agent on crypto takes a slice of bitcoin and ether to cash;
    // the agent on funds gets nothing from it, nor the crypto agent from a rate hike.
    const failure = event("crypto_exchange_failure", "2026-01-13T03:15:00.000Z");
    const crypto = eventAgentSignals([failure, hike], { level: 5, market: "crypto" });
    expect(crypto.map((s) => [s.ticker, s.weight])).toEqual([
      ["BTC/USD", -0.02],
      ["ETH/USD", -0.02],
    ]);
    expect(eventAgentSignals([failure], { level: 5 })).toEqual([]);
  });

  it("acts only while the type's record is at least a coin flip", () => {
    const e = event("fed_cut", "2026-01-13T00:15:00.000Z");
    expect(
      eventAgentSignals([e], { level: 3, seed: { fed_cut: { events: 40, hits: 14 } } }),
    ).toEqual([]);
    expect(
      eventAgentSignals([e], { level: 3, seed: { fed_cut: { events: 40, hits: 24 } } }),
    ).toHaveLength(1);
  });

  it("run through the agent's engine, buys the fund only after the event was public, with its reason", () => {
    const NO_COSTS = { feeBps: 0, halfSpreadBps: 0, slippageBps: 0 };
    const hours = (day: string) =>
      ["14:30", "15:30", "16:30", "17:30", "18:30", "19:30"].map((h) => `${day}T${h}:00Z`);
    const times = [...hours("2026-01-12"), ...hours("2026-01-13")];
    const bars = (price: number): AgentBar[] =>
      times.map((t) => ({ t, o: price, h: price, l: price, c: price, v: 1 }));
    const policy: Policy = {
      key: "test:spy",
      label: "All SPY",
      tickers: ["SPY", "SMH"],
      grid: [0],
      decide: (_tl, t) => (t === 0 ? { SPY: 1 } : null),
    };
    const signals = eventAgentSignals([event("chip_boom", "2026-01-13T00:15:00.000Z")], {
      level: 3,
    });
    const run = runAgent(
      startState(1_000_000),
      { SPY: bars(50_000), SMH: bars(25_000), BIL: bars(9_150) },
      signals,
      {
        policy,
        param: 0,
        costs: NO_COSTS,
        cash: "BIL",
        master: "SPY",
        session: "nyse",
        minutes: 60,
      },
    );
    const smh = run.trades.filter((t) => t.ticker === "SMH");
    expect(smh.length).toBeGreaterThan(0);
    // Public on the 13th at 00:15: Monday's bars never trade it.
    expect(smh.every((t) => t.at >= "2026-01-13T00:15:00.000Z")).toBe(true);
    expect(smh[0]).toMatchObject({ side: "buy", source: "events" });
    expect(smh[0].reason).toContain("Record chip demand");
    expect(smh[0].amountCents / 1_000_000).toBeCloseTo(EVENT_TILT_BY_LEVEL[3], 2);
  });
  it("run through the agent's engine, gets out at the overlay's stop when the fund falls", () => {
    const NO_COSTS = { feeBps: 0, halfSpreadBps: 0, slippageBps: 0 };
    const hours = (day: string) =>
      ["14:30", "15:30", "16:30", "17:30", "18:30", "19:30"].map((h) => `${day}T${h}:00Z`);
    const times = [...hours("2026-01-13"), ...hours("2026-01-14")];
    // SMH falls 10% from the second day's open: past the 7% stop.
    const bars = (price: number, drop = 1): AgentBar[] =>
      times.map((t) => {
        const p = t >= "2026-01-14" ? Math.round(price * drop) : price;
        return { t, o: p, h: p, l: p, c: p, v: 1 };
      });
    const policy: Policy = {
      key: "test:spy",
      label: "All SPY",
      tickers: ["SPY", "SMH"],
      grid: [0],
      decide: (_tl, t) => (t === 0 ? { SPY: 1 } : null),
    };
    const signals = eventAgentSignals([event("chip_boom", "2026-01-13T00:15:00.000Z")], {
      level: 3,
    });
    const run = runAgent(
      startState(1_000_000),
      { SPY: bars(50_000), SMH: bars(25_000, 0.9), BIL: bars(9_150) },
      signals,
      {
        policy,
        param: 0,
        costs: NO_COSTS,
        cash: "BIL",
        master: "SPY",
        session: "nyse",
        minutes: 60,
      },
    );
    const smh = run.trades.filter((t) => t.ticker === "SMH");
    expect(smh.map((t) => t.side)).toEqual(["buy", "sell"]);
    expect(smh[1].reason).toMatch(/^Stopped: SMH closed 10% below the signal's fill/);
    // Long before its 20 trading days were up.
    expect(smh[1].at < signals[0].until!).toBe(true);
  });
});
