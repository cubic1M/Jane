import { describe, expect, it } from "vitest";
import {
  THEME_ALTERNATIVE_EVIDENCE,
  THEME_EVIDENCE,
  themeConfidence,
} from "@/config/theme-evidence";
import { THEMES, THEME_IDS, THEME_HOLD_DAYS, THEME_STOP_LOSS } from "@/config/themes";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { themeEvidence, themeTrades } from "./themes";

// The news themes' backtest: bought the day the news broke, out after a month or at the stop,
// against the market over the same days; and the committed evidence is the fixture's own.

const day = (n: number) => new Date(Date.UTC(2024, 0, 1 + n)).toISOString().slice(0, 10);
const line = (prices: number[]): Bar[] =>
  prices.map((p, i) => ({ date: day(i), closeCents: p * 100 }));

describe("themeTrades", () => {
  it("holds for the window, after costs, against the market over the same days", () => {
    const fund = line(Array.from({ length: 30 }, (_, i) => 100 + i));
    const market = line(Array.from({ length: 30 }, () => 100));
    const [t] = themeTrades({ X: fund, VTI: market }, { ticker: "X", events: [day(2)] });
    expect(t.bought).toBe(day(2));
    expect(t.sold).toBe(day(2 + THEME_HOLD_DAYS));
    expect(t.stopped).toBe(false);
    expect(t.returnShare).toBeCloseTo(122 / 102 - 1 - 0.001, 6);
    expect(t.marketShare).toBe(0);
  });

  it("gets out at the stop", () => {
    const prices = Array.from({ length: 30 }, (_, i) =>
      i === 5 ? 100 * (1 - THEME_STOP_LOSS) - 1 : 100,
    );
    const [t] = themeTrades(
      { X: line(prices), VTI: line(Array(30).fill(100)) },
      { ticker: "X", events: [day(0)] },
    );
    expect(t).toMatchObject({ stopped: true, sold: day(5) });
  });

  it("skips an event without a whole window after it", () => {
    const fund = line(Array(10).fill(100));
    expect(themeTrades({ X: fund, VTI: fund }, { ticker: "X", events: [day(1)] })).toEqual([]);
  });
});

describe("themeEvidence", () => {
  it("holds up only when it beat the market on average and at least half the time", () => {
    const t = (r: number, m: number) => ({
      event: "",
      bought: "",
      sold: "",
      stopped: false,
      returnShare: r,
      marketShare: m,
    });
    expect(themeEvidence([t(0.05, 0), t(-0.01, 0)]).heldUp).toBe(true);
    expect(themeEvidence([t(0.05, 0), t(-0.01, 0), t(-0.01, 0)]).heldUp).toBe(false);
    expect(themeEvidence([t(0.01, 0), t(-0.05, 0)]).heldUp).toBe(false);
    expect(themeEvidence([]).heldUp).toBe(false);
  });
});

describe("on real closes (the fixture)", () => {
  const bars = realFixtureBars();
  it.each(THEME_IDS)("%s: the committed evidence is the replay's own", (id) => {
    const e = themeEvidence(themeTrades(bars, THEMES[id]));
    const c = THEME_EVIDENCE[id];
    expect(e.events).toBe(c.events);
    expect(e.events).toBe(THEMES[id].events.length);
    expect(e.hits).toBe(c.hits);
    expect(e.heldUp).toBe(c.heldUp);
    for (const k of ["averageReturn", "averageExcess", "worst", "best"] as const)
      expect(e[k]).toBeCloseTo(c[k], 3);
  });

  it("records every alternative fund's own replay too", () => {
    const listed = THEME_IDS.flatMap((id) =>
      (THEMES[id].alternatives ?? []).map((t) => `${id}:${t}`),
    );
    expect(THEME_ALTERNATIVE_EVIDENCE.map((a) => `${a.theme}:${a.ticker}`)).toEqual(listed);
    for (const a of THEME_ALTERNATIVE_EVIDENCE) {
      const e = themeEvidence(themeTrades(bars, { ...THEMES[a.theme], ticker: a.ticker }));
      expect(e.hits).toBe(a.hits);
      expect(e.heldUp).toBe(a.heldUp);
      expect(e.averageExcess).toBeCloseTo(a.averageExcess, 3);
    }
  });

  it("drops the themes that never held up, and keeps a confidence below certain", () => {
    expect(THEME_IDS.filter((id) => THEME_EVIDENCE[id].heldUp).sort()).toEqual([
      "chip_boom",
      "conflict_defense",
    ]);
    for (const id of THEME_IDS) {
      const p = themeConfidence(THEME_EVIDENCE[id]);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(100);
    }
  });
});

describe("THEMES", () => {
  it("each event list is in order, and each theme's triggers read its kind of headline", () => {
    for (const id of THEME_IDS) expect([...THEMES[id].events].sort()).toEqual(THEMES[id].events);
    const reads = (id: (typeof THEME_IDS)[number], title: string) =>
      THEMES[id].triggers.every((r) => r.test(title));
    expect(
      reads("middle_east_oil", "Iran fires missiles at Israel as Middle East conflict widens"),
    ).toBe(true);
    expect(reads("middle_east_oil", "Oil prices steady as OPEC meets")).toBe(false);
    expect(reads("conflict_defense", "Russia invades Ukraine; troops cross the border")).toBe(true);
    expect(reads("rate_cut_bonds", "Fed cuts rates by a quarter point")).toBe(true);
    expect(reads("rate_cut_bonds", "Fed holds rates steady")).toBe(false);
    expect(reads("chip_boom", "Nvidia soars on record AI chip demand")).toBe(true);
    expect(reads("risk_off_gold", "Stocks plunge as recession fears spread")).toBe(true);
  });
});
