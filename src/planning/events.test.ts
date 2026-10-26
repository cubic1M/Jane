import { describe, expect, it } from "vitest";
import {
  EVENT_COOL_OFF_DAYS,
  EVENT_HOLD_DAYS,
  EVENT_MAX_EXPOSURE_BY_LEVEL,
  EVENT_STOP,
  EVENT_TILT_BY_LEVEL,
  GDELT_BASELINE_DAYS,
} from "@/config/events";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { runEventBacktest } from "./event-backtest";
import {
  classifyText,
  coverageSpikes,
  knownBy,
  priceShocks,
  withCoolOff,
  type Coverage,
  type MarketEvent,
} from "./event-detect";
import {
  confidenceFor,
  emptyOverlay,
  overlayStep,
  tiltedTargets,
  weekdaysBetween,
  type ClosedSlice,
  type EventSlice,
} from "./event-overlay";
import { mixWeights } from "./paper";

// The events overlay (founder, 2026-10-26): events map to themes by rules; the overlay tilts the
// strategy within its limits and never replaces it; and the backtest never looks ahead.

const event = (over: Partial<MarketEvent> = {}): MarketEvent => ({
  key: "gdelt:me_conflict:2024-04-13",
  type: "me_conflict",
  source: "gdelt",
  date: "2024-04-13",
  knownAt: "2024-04-14T00:15:00.000Z",
  title: "Fighting in the Middle East",
  url: null,
  strength: 3,
  ...over,
});

const days = (from: string, n: number): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); out.length < n; t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

describe("events to themes, by rules", () => {
  it("maps each kind of headline to its type, and ordinary news to none", () => {
    const type = (t: string) => classifyText(t)[0]?.type ?? null;
    expect(type("Iran launches missiles and drones at Israel")).toBe("me_conflict");
    expect(type("Russia invades Ukraine as troops cross the border")).toBe("war");
    expect(type("Fed cuts rates by half a point")).toBe("fed_cut");
    expect(type("The Federal Reserve raises interest rates again")).toBe("fed_hike");
    expect(type("OPEC+ agrees to deep output cuts; crude jumps")).toBe("oil_shock");
    expect(type("Inflation runs hotter than expected in September")).toBe("inflation_hot");
    expect(type("Stocks plunge as Wall Street has its worst day since 2020")).toBe("market_panic");
    expect(type("Regulators seized the bank after a bank run")).toBe("bank_stress");
    expect(type("Nvidia beats estimates on record chip demand")).toBe("chip_boom");
    expect(type("Apple names a new head of services")).toBeNull();
    expect(type("Microsoft announces a large new data-center investment")).toBeNull();
  });

  it("finds a coverage spike against the days before it only, known after its day ends", () => {
    const quiet: Coverage[] = days("2024-01-01", 60).map((date) => ({
      date,
      count: 300,
      total: 100_000,
    }));
    const spike = quiet.map((c, i) => (i === 45 ? { ...c, count: 1_200 } : c));
    const [e, ...rest] = coverageSpikes("me_conflict", spike);
    expect(rest).toEqual([]);
    expect(e.date).toBe(spike[45].date);
    expect(e.strength).toBe(4);
    expect(knownBy(e, e.date)).toBe(false);
    // A spike inside the first baseline window is never judged.
    const early = quiet.map((c, i) => (i === GDELT_BASELINE_DAYS - 1 ? { ...c, count: 5_000 } : c));
    expect(coverageSpikes("me_conflict", early)).toEqual([]);
    // Too few articles is not an event, however sharp.
    const thin = quiet.map((c, i) => ({ ...c, count: i === 45 ? 150 : 20 }));
    expect(coverageSpikes("me_conflict", thin)).toEqual([]);
  });

  it("finds sharp price moves, known after that close", () => {
    const bars = {
      VTI: [
        { date: "2020-03-11", closeCents: 10_000 },
        { date: "2020-03-12", closeCents: 9_000 },
        { date: "2020-03-13", closeCents: 9_100 },
      ],
    };
    const [e] = priceShocks(bars);
    expect(e).toMatchObject({ type: "market_panic", date: "2020-03-12", source: "price" });
    expect(knownBy(e, "2020-03-12")).toBe(false);
    expect(knownBy(e, "2020-03-13")).toBe(true);
  });

  it("counts one event per type in the cool-off, the earliest known", () => {
    const a = event({ key: "a", date: "2024-04-13", knownAt: "2024-04-14T00:15:00.000Z" });
    const b = event({ key: "b", date: "2024-04-20", knownAt: "2024-04-21T00:15:00.000Z" });
    const c = event({
      key: "c",
      type: "war",
      date: "2024-04-20",
      knownAt: "2024-04-21T00:15:00.000Z",
    });
    const later = event({ key: "d", date: "2024-05-20", knownAt: "2024-05-21T00:15:00.000Z" });
    expect(EVENT_COOL_OFF_DAYS).toBeLessThan(30);
    // b is the same kind of event a week after a: left out. Another type (c) and a month later (d)
    // count.
    expect(withCoolOff([b, later, c, a]).map((e) => e.key)).toEqual(["a", "c", "d"]);
  });
});

describe("how sure", () => {
  const closed = (hit: boolean, key: string): ClosedSlice => ({
    eventKey: key,
    type: "fed_cut",
    ticker: "TLT",
    side: "buy",
    tilt: 0.02,
    enteredOn: "2024-01-02",
    entryCents: 100,
    confidence: 50,
    reason: "",
    exitedOn: "2024-02-01",
    exitCents: 110,
    stopped: false,
    fundReturn: 0.1,
    baseReturn: 0.01,
    hit,
  });

  it("starts at a coin flip and moves with the type's own record", () => {
    expect(confidenceFor("fed_cut", [])).toBe(50);
    const wins = ["a", "b", "c", "d"].map((k) => closed(true, k));
    expect(confidenceFor("fed_cut", wins)).toBe(75);
    expect(
      confidenceFor(
        "fed_cut",
        ["a", "b", "c", "d"].map((k) => closed(false, k)),
      ),
    ).toBe(25);
    // Another type's record doesn't count.
    expect(confidenceFor("war", wins)).toBe(50);
    // Never certain.
    expect(
      confidenceFor(
        "fed_cut",
        Array.from({ length: 200 }, (_, i) => closed(true, `${i}`)),
      ),
    ).toBe(90);
  });
});

describe("the overlay", () => {
  const base = mixWeights(3);
  const prices = { VTI: 30_000, VXUS: 6_000, BND: 7_000, BIL: 9_100, XLE: 9_000, ITA: 15_000 };
  const step = (state = emptyOverlay(), over: Partial<Parameters<typeof overlayStep>[1]> = {}) =>
    overlayStep(state, {
      date: "2024-04-15",
      level: 3,
      base,
      prices,
      events: [event()],
      baseReturn: () => 0,
      ...over,
    });

  it("tilts the strategy's targets and never replaces them", () => {
    const { actions, targets, state } = step();
    expect(actions.filter((a) => a.kind === "enter")).toHaveLength(2);
    expect(state.open.map((s) => s.ticker)).toEqual(["XLE", "ITA"]);
    const tilt = EVENT_TILT_BY_LEVEL[3];
    expect(targets.XLE + targets.ITA).toBeCloseTo(tilt);
    expect(targets.VTI).toBeCloseTo(base.VTI * (1 - tilt));
    expect(Object.values(targets).reduce((a, w) => a + w, 0)).toBeCloseTo(1);
    // The reason names the event and the exit.
    expect(state.open[0].reason).toContain("Fighting in the Middle East");
    expect(state.open[0].reason).toContain(`${EVENT_HOLD_DAYS} trading days`);
  });

  it("acts only on events known by the day's close", () => {
    const late = event({ knownAt: "2024-04-15T20:30:00.000Z" });
    expect(step(undefined, { events: [late] }).actions).toEqual([]);
    expect(step(undefined, { events: [late], date: "2024-04-16" }).actions).toHaveLength(2);
  });

  it("decides each event once", () => {
    const first = step();
    expect(step(first.state).actions).toEqual([]);
  });

  it("keeps all event slices within the level's limit", () => {
    const many = (["me_conflict", "war", "oil_shock", "chip_boom", "market_panic"] as const).map(
      (type, i) => event({ key: `e${i}`, type }),
    );
    const allPrices = { ...prices, GLD: 20_000, DBC: 2_000, SMH: 25_000, IEF: 9_500 };
    for (const level of [1, 3, 5] as const) {
      const { state } = step(undefined, { level, events: many, prices: allPrices });
      const used = state.open.reduce((a, s) => a + s.tilt, 0);
      expect(used).toBeLessThanOrEqual(EVENT_MAX_EXPOSURE_BY_LEVEL[level] + 1e-9);
    }
  });

  it("never trims below what the strategy holds, and never shorts", () => {
    const open: EventSlice[] = [
      {
        eventKey: "k",
        type: "fed_hike",
        ticker: "BND",
        side: "trim",
        tilt: 0.9,
        enteredOn: "2024-01-02",
        entryCents: 7_000,
        confidence: 60,
        reason: "",
      },
    ];
    const t = tiltedTargets(base, open);
    expect(t.BND ?? 0).toBeGreaterThanOrEqual(0);
    expect(Object.values(t).every((w) => w >= 0)).toBe(true);
    expect(Object.values(t).reduce((a, w) => a + w, 0)).toBeCloseTo(1);
  });

  it("gets out after the holding days, or at the stop", () => {
    const entered = step().state;
    const start = "2024-04-15";
    const due = days("2024-04-16", EVENT_HOLD_DAYS).at(-1)!;
    expect(weekdaysBetween(start, due)).toBe(EVENT_HOLD_DAYS);
    const before = days("2024-04-16", EVENT_HOLD_DAYS - 1).at(-1)!;
    expect(step(entered, { date: before, events: [] }).state.open).toHaveLength(2);
    const out = step(entered, { date: due, events: [], baseReturn: () => 0.01 });
    expect(out.actions.map((a) => a.kind)).toEqual(["exit", "exit"]);
    expect(out.targets).toEqual(base);
    const crash = { ...prices, XLE: Math.round(prices.XLE * (1 - EVENT_STOP - 0.01)) };
    const stopped = step(entered, { date: "2024-04-17", events: [], prices: crash });
    expect(stopped.actions.map((a) => a.kind)).toEqual(["stop"]);
    expect(stopped.state.closed[0]).toMatchObject({ ticker: "XLE", stopped: true, hit: false });
  });

  it("skips an event whose type has a poor record so far", () => {
    const poor = Array.from({ length: 8 }, (_, i) => ({
      eventKey: `p${i}`,
      type: "me_conflict" as const,
      ticker: "XLE",
      side: "buy" as const,
      tilt: 0.01,
      enteredOn: "2023-01-02",
      entryCents: 1,
      confidence: 50,
      reason: "",
      exitedOn: "2023-02-01",
      exitCents: 1,
      stopped: false,
      fundReturn: -0.05,
      baseReturn: 0,
      hit: false,
    }));
    const { actions } = step({ open: [], closed: poor, seen: [] });
    expect(actions).toEqual([expect.objectContaining({ kind: "skip" })]);
  });
});

describe("the backtest", () => {
  const bars = realFixtureBars();
  const level = 3 as const;
  const base = mixWeights(level);
  const events: MarketEvent[] = [
    event({ key: "e1", date: "2019-09-14", knownAt: "2019-09-15T00:15:00.000Z" }),
    event({
      key: "e2",
      type: "market_panic",
      date: "2020-02-24",
      knownAt: "2020-02-25T00:15:00.000Z",
    }),
    event({ key: "e3", type: "fed_cut", date: "2020-03-15", knownAt: "2020-03-16T00:15:00.000Z" }),
    event({ key: "e4", type: "war", date: "2022-02-24", knownAt: "2022-02-25T00:15:00.000Z" }),
    event({ key: "e5", type: "fed_hike", date: "2022-06-15", knownAt: "2022-06-15T18:00:00.000Z" }),
    event({ key: "e6", date: "2023-10-07", knownAt: "2023-10-08T00:15:00.000Z" }),
  ];
  const run = (to: string, b: Record<string, readonly Bar[]> = bars) =>
    runEventBacktest({ bars: b, events, level, base, from: "2019-01-02", to });

  it("is exactly the strategy when there are no events", () => {
    const r = runEventBacktest({
      bars,
      events: [],
      level,
      base,
      from: "2019-01-02",
      to: "2021-12-31",
    });
    expect(r.values.every((v) => v.base === v.overlay)).toBe(true);
    expect(r.actions).toEqual([]);
  });

  it("never looks ahead: cutting history off, or changing what came after, changes nothing before", () => {
    const cut = "2022-03-31";
    const full = run("2024-12-31");
    const short = run(cut);
    const upTo = <T extends { date: string }>(xs: readonly T[]) => xs.filter((x) => x.date <= cut);
    expect(upTo(full.values)).toEqual(short.values);
    expect(upTo(full.actions)).toEqual(short.actions);
    // Doubling every close after the cut leaves every decision before it alone.
    const poisoned = Object.fromEntries(
      Object.entries(bars).map(([t, s]) => [
        t,
        s.map((b) => (b.date > cut ? { ...b, closeCents: b.closeCents * 2 } : b)),
      ]),
    );
    const p = run("2024-12-31", poisoned);
    expect(upTo(p.values)).toEqual(short.values);
    expect(upTo(p.actions)).toEqual(short.actions);
  });

  it("enters on the first close after an event is known, never the day of a weekend event", () => {
    const r = run("2020-12-31");
    const first = r.actions.find((a) => a.action.kind === "enter" && a.action.event.key === "e1");
    // Saturday's news, known Sunday: Monday's close.
    expect(first?.date).toBe("2019-09-16");
    const hike = r.actions.find((a) => a.action.kind === "enter" && a.action.event.key === "e3");
    expect(hike?.date).toBe("2020-03-16");
  });

  it("reports returns, drawdown, Sharpe and a record per type", () => {
    const r = run("2024-12-31");
    for (const m of [r.base, r.overlay]) {
      expect(Number.isFinite(m.totalReturn)).toBe(true);
      expect(m.maxDrawdown).toBeLessThanOrEqual(0);
      expect(Number.isFinite(m.sharpe)).toBe(true);
    }
    const typed = r.types.filter((t) => t.events > 0).map((t) => t.type);
    expect(typed).toEqual(
      expect.arrayContaining(["me_conflict", "market_panic", "fed_cut", "war"]),
    );
  });
});
