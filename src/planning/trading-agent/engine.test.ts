import { describe, expect, it } from "vitest";
import { AGENT_MARKETS } from "@/config/trading-agent";
import { timelineOf } from "./clock";
import { overlay, runAgent, runOnTimeline, startState } from "./engine";
import { walkBars } from "./fixtures";
import { policiesFor } from "./policies";
import type { AgentBar, AgentSignal, AgentState, Policy } from "./types";

// The 24-hour agent's loop: fills at the next bar's open after costs (worked by hand), nothing
// read ahead, and a catch-up in pieces exactly equal to one run without a break.

const crypto = AGENT_MARKETS.crypto;
const stocks = AGENT_MARKETS.stocks;
const NO_COSTS = { feeBps: 0, halfSpreadBps: 0, slippageBps: 0 };

const bar = (t: string, o: number, c = o): AgentBar => ({
  t,
  o,
  h: Math.max(o, c),
  l: Math.min(o, c),
  c,
  v: 1,
});

// Buys everything on the first bar's close, sells it all at the third.
const scripted = (plan: Record<number, Record<string, number>>): Policy => ({
  key: "test:scripted",
  label: "Scripted",
  tickers: ["BTC/USD"],
  grid: [0],
  decide: (_tl, t) => plan[t] ?? null,
});

const cryptoConfig = (policy: Policy, param = 0) => ({
  policy,
  param,
  costs: crypto,
  cash: crypto.cash,
  master: "BTC/USD",
  session: "24h" as const,
  minutes: 60,
});

describe("fills", () => {
  it("fills at the next bar's open, with the spread, slippage and fee (worked by hand)", () => {
    // $10,000. Bar 0 closes at $100.00: the rule asks for all bitcoin. Bar 1 opens at $101.00:
    // bought at 101.00 × (1 + 3 bps) = 101.0303 a coin, the 25 bps fee on top:
    // 10,000 / 1.0025 = 9,975.0623 changes hands, 98.733 coins, a fee of 24.9377.
    const bars = {
      "BTC/USD": [
        bar("2026-01-05T00:00:00Z", 10_000),
        bar("2026-01-05T01:00:00Z", 10_100, 10_200),
        bar("2026-01-05T02:00:00Z", 10_300, 10_400),
        bar("2026-01-05T03:00:00Z", 10_500, 10_500),
      ],
    };
    const run = runAgent(
      startState(1_000_000),
      bars,
      [],
      cryptoConfig(scripted({ 0: { "BTC/USD": 1 }, 2: {} })),
    );
    expect(run.trades).toHaveLength(2);
    const [buy, sell] = run.trades;
    expect(buy.at).toBe("2026-01-05T01:00:00Z");
    expect(buy.side).toBe("buy");
    expect(buy.priceCents).toBeCloseTo(10_103.03, 6);
    expect(buy.amountCents).toBeCloseTo(997_506.2344, 3);
    expect(buy.feeCents).toBeCloseTo(2_493.7656, 3);
    expect(buy.spreadCents).toBeCloseTo(buy.quantity * 3.03, 6);
    expect(buy.quantity).toBeCloseTo(1_000_000 / 1.0025 / 10_103.03, 9);
    // Valued at bar 1's close: the coins at $102.00, no cash left.
    expect(run.values[1].valueCents).toBeCloseTo(buy.quantity * 10_200, 6);
    // Sold at bar 3's open, $105.00 less 3 bps, the fee off the proceeds.
    expect(sell.at).toBe("2026-01-05T03:00:00Z");
    expect(sell.priceCents).toBeCloseTo(10_500 * 0.9997, 6);
    const gross = buy.quantity * 10_500 * 0.9997;
    expect(sell.amountCents).toBeCloseTo(gross, 6);
    expect(sell.feeCents).toBeCloseTo(gross * 0.0025, 6);
    expect(run.state.cash).toBeCloseTo(gross * 0.9975, 6);
    expect(run.state.units).toEqual({});
  });

  it("fills a decision made at the last bar of the day at the next morning's open (the gap)", () => {
    const spy = [
      bar("2026-01-09T20:30:00Z", 50_000), // Friday, 3:30 p.m. New York: the last bar
      bar("2026-01-12T14:30:00Z", 48_000, 48_500), // Monday's open, after a weekend gap down
    ];
    const run = runAgent(
      startState(1_000_000),
      { SPY: spy, BIL: spy.map((b) => ({ ...b, o: 9_150, h: 9_150, l: 9_150, c: 9_150 })) },
      [],
      {
        policy: { ...scripted({ 0: { SPY: 1 } }), tickers: ["SPY"] },
        param: 0,
        costs: NO_COSTS,
        cash: stocks.cash,
        master: "SPY",
        session: "nyse",
        minutes: 60,
      },
    );
    expect(run.trades[0]).toMatchObject({ at: "2026-01-12T14:30:00Z", priceCents: 48_000 });
  });

  it("pays nothing to hold plain cash, and never trades it", () => {
    const bars = {
      "BTC/USD": [bar("2026-01-05T00:00:00Z", 10_000), bar("2026-01-05T01:00:00Z", 10_000)],
    };
    const run = runAgent(
      startState(1_000_000),
      bars,
      [],
      cryptoConfig(scripted({ 0: { USD: 1 } })),
    );
    expect(run.trades).toEqual([]);
    expect(run.state.cash).toBe(1_000_000);
  });
});

describe("no lookahead", () => {
  // Every crypto policy, and the market-hours rules on SPY and QQQ, on made-up bars: run on the
  // first m bars, the trades and values up to bar m are exactly those of the run on all of them.
  const btc = walkBars("BTC/USD", {
    from: "2025-01-01T00:00:00Z",
    count: 900,
    minutes: 60,
    vol: 0.02,
  });
  const eth = walkBars("ETH/USD", {
    from: "2025-01-01T00:00:00Z",
    count: 900,
    minutes: 60,
    vol: 0.025,
  });
  const cryptoBars = { "BTC/USD": btc, "ETH/USD": eth };
  const m = 700;

  for (const policy of policiesFor("crypto")) {
    it(`${policy.key} decides from bars up to its own`, () => {
      const param = policy.grid[0];
      const full = runAgent(startState(1_000_000), cryptoBars, [], cryptoConfig(policy, param));
      const cut = runAgent(
        startState(1_000_000),
        { "BTC/USD": btc.slice(0, m), "ETH/USD": eth.slice(0, m) },
        [],
        cryptoConfig(policy, param),
      );
      const before = (t: { at: string }) => t.at <= btc[m - 1].t;
      expect(cut.trades).toEqual(full.trades.filter(before));
      expect(cut.values).toEqual(full.values.slice(0, m));
    });
  }
});

describe("catch-up", () => {
  const btc = walkBars("BTC/USD", {
    from: "2025-03-01T00:00:00Z",
    count: 1_200,
    minutes: 15,
    vol: 0.01,
  });
  const eth = walkBars("ETH/USD", {
    from: "2025-03-01T00:00:00Z",
    count: 1_200,
    minutes: 15,
    vol: 0.012,
  });
  const all = { "BTC/USD": btc, "ETH/USD": eth };
  // The events layer's signals: half the account in ether for a while.
  const signals: AgentSignal[] = [
    {
      id: "news-1",
      at: btc[400].t,
      until: btc[520].t,
      ticker: "ETH/USD",
      weight: 0.5,
      reason: "Ether: a planned upgrade went live (test).",
      source: "events",
    },
    // And one with a tight stop, so the stop's state is carried between ticks too.
    {
      id: "news-2",
      at: btc[600].t,
      until: btc[1_100].t,
      ticker: "ETH/USD",
      weight: 0.4,
      reason: "Ether: a second event (test).",
      source: "events",
      stopPct: 0.004,
    },
  ];

  for (const policy of policiesFor("crypto").filter((_, i) => i % 3 === 0)) {
    it(`${policy.key}: ticks at any times land exactly where one run does`, () => {
      const config = { ...cryptoConfig(policy, policy.grid.at(-1)!), minutes: 15 };
      const once = runAgent(startState(1_000_000), all, signals, config);
      // Ticks at uneven times, the state stored as JSON between them (as in the database).
      let state: AgentState = startState(1_000_000);
      const trades = [];
      const values = [];
      for (const upTo of [1, 37, 38, 260, 401, 402, 777, 1_000, 1_200]) {
        const seen = { "BTC/USD": btc.slice(0, upTo), "ETH/USD": eth.slice(0, upTo) };
        const run = runAgent(JSON.parse(JSON.stringify(state)), seen, signals, config);
        state = run.state;
        trades.push(...run.trades);
        values.push(...run.values);
      }
      expect(trades).toEqual(once.trades);
      expect(values).toEqual(once.values);
      expect(state).toEqual(once.state);
      // The tight stop fired along the way, and the pieces agree on it.
      expect(once.trades.some((t) => t.reason.startsWith("Stopped: ETH/USD"))).toBe(true);
      expect(state.stops?.["news-2"]).toBe("hit");
    });
  }

  it("a tick with nothing new changes nothing", () => {
    const config = cryptoConfig(policiesFor("crypto")[0]);
    const run = runAgent(startState(1_000_000), all, [], config);
    const again = runAgent(run.state, all, [], config);
    expect(again.trades).toEqual([]);
    expect(again.values).toEqual([]);
    expect(again.state).toEqual(run.state);
  });
});

describe("signals", () => {
  it("lays a tilt on top of the strategy's own weight, never below nothing or above the account", () => {
    const tilt = (ticker: string, weight: number) => ({
      id: ticker,
      at: "",
      ticker,
      weight,
      reason: "",
      source: "events",
      tilt: true,
    });
    // A slice in bitcoin on a strategy already all in bitcoin changes nothing.
    expect(overlay({ "BTC/USD": 1 }, [tilt("BTC/USD", 0.04)])).toEqual({ "BTC/USD": 1 });
    // A trim takes that share to cash.
    expect(overlay({ "BTC/USD": 1 }, [tilt("BTC/USD", -0.04)])).toEqual({ "BTC/USD": 0.96 });
    // A slice in another fund comes from the rest.
    const spy = overlay({ SPY: 1 }, [tilt("SMH", 0.02)]);
    expect(spy.SMH).toBeCloseTo(0.02);
    expect(spy.SPY).toBeCloseTo(0.98);
    // Never below nothing.
    expect(overlay({ SPY: 1 }, [tilt("BND", -0.05)])).toEqual({ SPY: 1 });
  });

  it("lays a signal's weight over the strategy's, and takes it off when it ends", () => {
    expect(overlay({ "BTC/USD": 1 }, [])).toEqual({ "BTC/USD": 1 });
    expect(
      overlay({ "BTC/USD": 0.6, USD: 0.4 }, [
        { id: "a", at: "", ticker: "ETH/USD", weight: 0.5, reason: "", source: "events" },
      ]),
    ).toEqual({ "BTC/USD": 0.3, USD: 0.2, "ETH/USD": 0.5 });
    const bars = {
      "BTC/USD": Array.from({ length: 6 }, (_, i) => bar(`2026-01-05T0${i}:00:00Z`, 10_000)),
      "ETH/USD": Array.from({ length: 6 }, (_, i) => bar(`2026-01-05T0${i}:00:00Z`, 5_000)),
    };
    const signal: AgentSignal = {
      id: "s",
      at: "2026-01-05T01:30:00Z",
      until: "2026-01-05T04:00:00Z",
      ticker: "ETH/USD",
      weight: 0.25,
      reason: "A filing (test).",
      source: "events",
    };
    const run = runAgent(startState(1_000_000), bars, [signal], {
      ...cryptoConfig(scripted({ 0: { "BTC/USD": 1 } })),
      costs: NO_COSTS,
    });
    // Bought bitcoin at bar 1; the signal is in force at bar 1's close (02:00), so at bar 2's open
    // a quarter goes to ether with the signal's reason; it ends before bar 3 closes, so ether is
    // sold at bar 4's open.
    expect(run.trades.map((t) => [t.at.slice(11, 16), t.side, t.ticker])).toEqual([
      ["01:00", "buy", "BTC/USD"],
      ["02:00", "sell", "BTC/USD"],
      ["02:00", "buy", "ETH/USD"],
      ["04:00", "sell", "ETH/USD"],
      ["04:00", "buy", "BTC/USD"],
    ]);
    expect(run.trades[2]).toMatchObject({ reason: "A filing (test).", source: "events" });
  });
});

describe("the clock", () => {
  it("counts bars, not hours, so a holiday is just the next bar", () => {
    const spy = [
      bar("2026-01-15T20:30:00Z", 100),
      bar("2026-01-20T14:30:00Z", 100), // after a long weekend
    ];
    const tl = timelineOf({ SPY: spy }, "SPY", "nyse");
    expect(tl.numbers).toEqual([0, 1]);
    const later = timelineOf({ SPY: spy }, "SPY", "nyse", { at: spy[1].t, n: 41 });
    expect(later.numbers).toEqual([40, 41]);
    expect(later.nextDate > later.dates[1]).toBe(true);
  });

  it("keeps only regular hours in market hours", () => {
    const tl = timelineOf(
      {
        SPY: [
          bar("2026-01-15T13:00:00Z", 1),
          bar("2026-01-15T14:30:00Z", 1),
          bar("2026-01-15T21:00:00Z", 1),
        ],
      },
      "SPY",
      "nyse",
    );
    expect(tl.times).toEqual(["2026-01-15T14:30:00Z"]);
  });

  it("runs the same loop on a timeline", () => {
    const btc = walkBars("BTC/USD", { from: "2025-01-01T00:00:00Z", count: 50, minutes: 60 });
    const tl = timelineOf({ "BTC/USD": btc }, "BTC/USD", "24h");
    const policy = scripted({ 3: { "BTC/USD": 1 } });
    const a = runOnTimeline(startState(1_000_000), tl, [], {
      ...cryptoConfig(policy),
      minutes: 60,
    });
    const b = runAgent(startState(1_000_000), { "BTC/USD": btc }, [], cryptoConfig(policy));
    expect(a).toEqual(b);
  });
});

describe("a signal's stop", () => {
  // Ether at $50 for two bars, then the given closes; bitcoin flat. The signal buys a quarter in
  // ether at bar 1's open (it is in force when bar 0 closes).
  const run = (closes: number[], stopPct: number | null) => {
    const n = closes.length + 2;
    const times = Array.from(
      { length: n },
      (_, i) => `2026-01-05T${String(i).padStart(2, "0")}:00:00Z`,
    );
    const eth = [5_000, 5_000, ...closes];
    return runAgent(
      startState(1_000_000),
      {
        "BTC/USD": times.map((t) => bar(t, 10_000)),
        "ETH/USD": times.map((t, i) => bar(t, i === 0 ? 5_000 : eth[i - 1], eth[i])),
      },
      [
        {
          id: "e",
          at: "2026-01-05T00:30:00Z",
          until: null,
          ticker: "ETH/USD",
          weight: 0.25,
          reason: "An event (test).",
          source: "events",
          stopPct,
        },
      ],
      { ...cryptoConfig(scripted({})), costs: NO_COSTS },
    );
  };

  it("ends the signal when the ticker closes that far against its fill, and sells at the next open", () => {
    // Filled at $50; bar 3 closes at $46 (8% down, past a 7% stop): sold at bar 4's open.
    const r = run([4_900, 4_600, 4_700, 4_800], 0.07);
    expect(r.trades.map((t) => [t.at.slice(11, 16), t.side, t.ticker])).toEqual([
      ["01:00", "buy", "ETH/USD"],
      ["04:00", "sell", "ETH/USD"],
    ]);
    expect(r.trades[1].reason).toBe(
      "Stopped: ETH/USD closed 8% below the signal's fill (its stop is 7%).",
    );
    expect(r.trades[1].source).toBe("events");
    expect(r.state.stops).toEqual({ e: "hit" });
    expect(r.state.units["ETH/USD"]).toBeUndefined();
  });

  it("holds through a smaller fall, and without a stop", () => {
    expect(run([4_900, 4_700, 4_800], 0.07).trades).toHaveLength(1);
    expect(run([4_900, 4_000, 4_100], null).trades).toHaveLength(1);
  });
});
