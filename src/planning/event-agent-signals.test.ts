import { describe, expect, it } from "vitest";
import {
  EVENT_MAX_EXPOSURE_BY_LEVEL,
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
      source: "events",
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
      { level: 2, base: { VTI: 0.3, VXUS: 0.15, BND: 0.5, BIL: 0.05 } },
    );
    const bought = many.filter((s) => s.ticker !== "BND").reduce((a, s) => a + s.weight, 0);
    expect(bought).toBeLessThanOrEqual(EVENT_MAX_EXPOSURE_BY_LEVEL[2] + 1e-9);
  });

  it("holds a trimmed fund at the strategy's weight less the slice, and leaves trims out without it", () => {
    const hike = event("fed_hike", "2026-01-13T00:15:00.000Z");
    const withBase = eventAgentSignals([hike], { level: 3, base: { BND: 0.35 } });
    expect(withBase.find((s) => s.ticker === "BND")?.weight).toBeCloseTo(0.35 - 0.01);
    expect(eventAgentSignals([hike], { level: 3 }).map((s) => s.ticker)).toEqual(["XLF"]);
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
});
