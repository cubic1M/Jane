import { describe, expect, it } from "vitest";
import { INTRADAY_EVIDENCE } from "@/config/intraday-evidence";
import {
  INTRADAY_RULE_IDS,
  INTRADAY_RULES,
  INTRADAY_SLIPPAGE,
  INTRADAY_TRAIN_END,
  INTRADAY_WARNING,
} from "@/config/intraday-strategies";
import type { IntradayBar } from "@/lib/market/types";
import {
  holdReplay,
  intradayReplay,
  intradayResult,
  newYork,
  sessionsOf,
  tradeOf,
  type Session,
} from "./intraday";

// The day-trading rules replayed on made-up 5-minute sessions: regular hours only, decisions from
// the bars already closed, out by the close, the stop counted first, slippage on every trade, and
// the setting chosen on the earlier years only.

type Shape = Partial<Omit<IntradayBar, "t">>;

// A January (New York winter time) session: 78 five-minute bars from 9:30, flat at `price` with a
// one-cent-a-side range (at `then` from bar 7 on, when given), with `at` overriding bars by index.
function session(
  date: string,
  price = 10_000,
  at: Record<number, Shape> = {},
  then = price,
): Session {
  const open = Date.parse(`${date}T14:30:00Z`);
  const bars = Array.from({ length: 78 }, (_, i) => {
    const p = i >= 7 ? then : price;
    const bar: IntradayBar = {
      t: new Date(open + i * 300_000).toISOString(),
      o: p,
      h: p + 1,
      l: p - 1,
      c: p,
      v: 1000,
      ...at[i],
    };
    return bar;
  });
  return sessionsOf(bars)[0];
}

describe("sessionsOf", () => {
  it("groups regular-hours bars by the New York day, in summer and winter time", () => {
    const winter = "2024-01-10T14:30:00Z";
    const summer = "2024-07-10T13:30:00Z";
    expect(newYork(winter)).toEqual({ date: "2024-01-10", minute: 570 });
    expect(newYork(summer)).toEqual({ date: "2024-07-10", minute: 570 });
  });

  it("drops the pre-market, the after-hours and short days", () => {
    const pre = { t: "2024-01-10T13:00:00Z", o: 1, h: 1, l: 1, c: 1, v: 1 };
    const post = { t: "2024-01-10T21:30:00Z", o: 1, h: 1, l: 1, c: 1, v: 1 };
    const s = session("2024-01-10");
    const out = sessionsOf([
      pre,
      ...s.bars,
      post,
      ...s.bars.slice(0, 10).map((b) => ({ ...b, t: b.t.replace("01-10", "01-11") })),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].bars).toHaveLength(78);
    expect(out[0].bars[0].minute).toBe(570);
    expect(out[0].bars.at(-1)!.minute).toBe(955);
  });
});

describe("tradeOf", () => {
  it("opening-range break: buys the first close above the range, out at twice the risk", () => {
    const s = session(
      "2024-01-10",
      10_000,
      {
        6: { c: 10_010, h: 10_010 },
        20: { h: 10_040 },
      },
      10_010,
    );
    // Range 9,999 to 10,001; entry 10,010; stop 9,999; target 10,032.
    expect(tradeOf("opening_range", 30, s, null)).toEqual({
      date: "2024-01-10",
      entry: 10_010,
      exit: 10_032,
      reason: "target",
    });
  });

  it("counts the stop when one bar reaches both", () => {
    const s = session(
      "2024-01-10",
      10_000,
      {
        6: { c: 10_010, h: 10_010 },
        7: { h: 10_100, l: 9_900 },
      },
      10_010,
    );
    expect(tradeOf("opening_range", 30, s, null)).toMatchObject({ exit: 9_999, reason: "stop" });
  });

  it("is never held overnight: out at the last close", () => {
    const s = session(
      "2024-01-10",
      10_000,
      { 6: { c: 10_002, h: 10_002 }, 77: { c: 10_003 } },
      10_002,
    );
    expect(tradeOf("opening_range", 30, s, null)).toMatchObject({ exit: 10_003, reason: "close" });
  });

  it("decides only from the bars already closed", () => {
    const base = { 6: { c: 10_010, h: 10_010 } };
    const a = tradeOf("opening_range", 30, session("2024-01-10", 10_000, base), null)!;
    const b = tradeOf(
      "opening_range",
      30,
      session("2024-01-10", 10_000, { ...base, 40: { h: 10_500 } }),
      null,
    )!;
    expect(b.entry).toBe(a.entry);
  });

  it("liquidity sweep: a morning dip under yesterday's low that closes back above it", () => {
    const prior = session("2024-01-09", 10_000);
    const s = session("2024-01-10", 10_000, { 3: { l: 9_990, c: 10_000 } });
    expect(tradeOf("liquidity_sweep", 2, s, prior)).toMatchObject({ entry: 10_000 });
    // The same sweep after 11:00 is outside the killzone.
    const late = session("2024-01-10", 10_000, { 30: { l: 9_990, c: 10_000 } });
    expect(tradeOf("liquidity_sweep", 2, late, prior)).toBeNull();
    expect(tradeOf("liquidity_sweep", 2, s, null)).toBeNull();
  });

  it("fair value gap: buys the return into a gap left by a sharp move", () => {
    const s = session("2024-01-10", 10_000, {
      2: { h: 10_001 },
      3: { o: 10_002, h: 10_030, l: 10_002, c: 10_030 },
      4: { o: 10_030, h: 10_040, l: 10_020, c: 10_035 },
      5: { o: 10_035, h: 10_036, l: 10_010, c: 10_015 },
      ...Object.fromEntries(
        Array.from({ length: 72 }, (_, k) => [
          k + 6,
          { o: 10_015, h: 10_016, l: 10_014, c: 10_015 },
        ]),
      ),
    });
    // Gap between bar 2's high (10,001) and bar 4's low (10,020), at least 0.1% of the price.
    expect(tradeOf("fair_value_gap", 0.001, s, null)).toMatchObject({ entry: 10_015 });
  });

  it("VWAP reversion: buys well below the day's average, out back at it", () => {
    const s = session("2024-01-10", 10_000, {
      10: { o: 10_000, h: 10_000, l: 9_930, c: 9_930 },
      11: { o: 9_930, h: 10_000, l: 9_929, c: 9_990 },
    });
    expect(tradeOf("vwap_reversion", 0.006, s, null)).toMatchObject({
      entry: 9_930,
      reason: "vwap",
    });
  });

  it("volume imbalance: a strong close on unusual volume buys the next bar", () => {
    const s = session("2024-01-10", 10_000, {
      14: { o: 10_000, h: 10_010, l: 10_000, c: 10_010, v: 5000 },
      15: { o: 10_011, h: 10_011, l: 10_010, c: 10_011 },
    });
    expect(tradeOf("volume_imbalance", 3, s, null)).toMatchObject({ entry: 10_011 });
    expect(tradeOf("volume_imbalance", 6, s, null)).toBeNull();
  });
});

describe("intradayReplay", () => {
  const days = (n: number, from = "2023-01-02") =>
    Array.from({ length: n }, (_, k) => {
      const d = new Date(Date.parse(`${from}T00:00:00Z`) + k * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return session(d, 10_000, { 6: { c: 10_002, h: 10_002 } }, 10_002);
    });

  it("pays slippage both ways on every trade", () => {
    const r = intradayReplay(days(5), "opening_range", 30)!;
    // Each trade buys and sells at 10,002: only the slippage both ways, four times.
    const one = (1 - INTRADAY_SLIPPAGE) / (1 + INTRADAY_SLIPPAGE);
    expect(r.metrics.trades).toBe(4);
    expect(r.path.at(-1)!.valueCents / 1_000_000).toBeCloseTo(one ** 4, 10);
    expect(r.metrics.winRate).toBe(0);
  });

  it("holding: close to close", () => {
    const s = [
      session("2024-01-08", 10_000),
      session("2024-01-09", 10_100),
      session("2024-01-10", 10_200),
    ];
    expect(holdReplay(s)!.path.map((p) => p.valueCents)).toEqual([1_000_000, 1_010_000, 1_020_000]);
  });

  it("chooses the setting on the earlier years only", () => {
    const train = days(10, "2023-12-01");
    const later = days(10, "2024-01-02");
    const a = intradayResult([...train, ...later], "opening_range")!;
    const changed = later.map((s) =>
      session(s.date, 9_000, { 6: { c: 9_100, h: 9_100 }, 20: { h: 9_500 } }),
    );
    const b = intradayResult([...train, ...changed], "opening_range")!;
    expect(b.param).toBe(a.param);
    expect(a.later.from).toBe("2024-01-02");
    expect(a.curve).toHaveLength(40);
    expect(a.curve[0]).toBe(100);
  });
});

// The committed evidence comes from the research run on Alpaca's bars (too many to commit); it
// must at least be a walk-forward of these rules and say honestly how each did against holding.
describe("the committed evidence", () => {
  it("has every rule, its setting from the grid, chosen before the years it is scored on", () => {
    for (const id of INTRADAY_RULE_IDS) {
      const r = INTRADAY_EVIDENCE[id];
      expect(INTRADAY_RULES[id].grid).toContain(r.param);
      expect(r.train.to <= INTRADAY_TRAIN_END).toBe(true);
      expect(r.later.from > INTRADAY_TRAIN_END).toBe(true);
      expect(r.holdLater.from).toBe(r.later.from);
      expect(r.beatsHolding).toBe(r.later.sortino > r.holdLater.sortino);
      expect(r.curve).toHaveLength(40);
      expect(r.curve[0]).toBe(100);
    }
  });

  it("warns plainly that most day traders lose money", () => {
    expect(INTRADAY_WARNING).toMatch(/^Most people who day trade lose money/);
  });
});
