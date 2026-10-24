import { describe, expect, it } from "vitest";
import { CATALOG, CATALOG_IDS, catalogTickers } from "@/config/strategy-catalog";
import type { Bar } from "@/lib/market/types";
import { alignCatalog, metricsOver, mixReturns, runCatalog, standalone } from "./engine";
import {
  expectedMaxSharpe,
  hrp,
  m13612w,
  maxDiversification,
  minVariance,
  normCdf,
  normInv,
  probabilisticSharpe,
  rsi,
  sma,
} from "./math";
import { decide, type Context } from "./strategies";

// The strategy catalog's engine on made-up prices: the arithmetic, every rule deciding only from
// the closes it has, the costs, the walk-forward and the haircut for testing many strategies.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Weekday closes from 2015 to late 2026: a random walk per fund (bills a steady climb).
function universe(drift = 0.0003) {
  const dates: string[] = [];
  for (let d = Date.parse("2015-01-02"); d <= Date.parse("2026-10-23"); d += 86_400_000) {
    const day = new Date(d).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(new Date(d).toISOString().slice(0, 10));
  }
  const bars: Record<string, Bar[]> = {};
  for (const [i, t] of catalogTickers().entries()) {
    const rand = seeded(i + 7);
    let v = 10_000;
    bars[t] = dates.map((date) => {
      v *= t === "BIL" ? 1.00008 : 1 + drift + 0.01 * (rand() - 0.5) * 2;
      return { date, closeCents: Math.max(1, Math.round(v)) };
    });
  }
  const spy = bars.SPY.map((b, k) => ({
    date: b.date,
    o: k > 0 ? bars.SPY[k - 1].closeCents : b.closeCents,
    h: Math.round(b.closeCents * 1.004),
    l: Math.round(b.closeCents * 0.993),
    c: b.closeCents,
  }));
  return alignCatalog(bars, spy)!;
}

describe("the arithmetic", () => {
  it("averages, RSI and Keller's momentum", () => {
    expect(sma([1, 2, 3, 4], 3, 2)).toBe(3.5);
    expect(sma([1, 2], 1, 3)).toBeNull();
    const up = Array.from({ length: 50 }, (_, i) => 100 + i);
    expect(rsi(up, 49, 2)).toBe(100);
    const flat = Array.from({ length: 300 }, () => 100);
    expect(m13612w(flat, 299)).toBe(0);
  });

  it("the optimizers stay long only, sum to one and respect the cap", () => {
    const cov = [
      [0.04, 0.01, 0],
      [0.01, 0.01, 0],
      [0, 0, 0.0025],
    ];
    for (const w of [minVariance(cov, 0.6), maxDiversification(cov, 0.6), hrp(cov)]) {
      expect(w.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
      for (const x of w) expect(x).toBeGreaterThanOrEqual(-1e-12);
    }
    const mv = minVariance(cov, 0.6);
    expect(mv[2]).toBeCloseTo(0.6, 3);
    // The least volatile gets the most.
    expect(hrp(cov)[2]).toBeGreaterThan(hrp(cov)[0]);
  });

  it("the normal, and the haircut that grows with the number of trials", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    for (const x of [-2, -0.5, 1, 2.5]) expect(normInv(normCdf(x))).toBeCloseTo(x, 3);
    expect(expectedMaxSharpe(100, 0.01)).toBeGreaterThan(expectedMaxSharpe(10, 0.01));
    expect(expectedMaxSharpe(1, 0.01)).toBe(0);
    const r = Array.from({ length: 1000 }, (_, i) => (i % 2 ? 0.011 : -0.009));
    // Its own Sharpe ratio as the hurdle: a coin toss.
    const sr = 0.001 / 0.01;
    expect(probabilisticSharpe(r, sr)).toBeCloseTo(0.5, 1);
    expect(probabilisticSharpe(r, 0)).toBeGreaterThan(0.99);
  });
});

describe("the rules", () => {
  const u = universe();
  const ctx = (): Context => ({ value: 1, held: {}, memo: {} });

  it("every strategy holds whole portfolios of its own funds", () => {
    for (const id of CATALOG_IDS) {
      const p = CATALOG[id].grid[CATALOG[id].grid.length - 1];
      let found = false;
      for (let t = 300; t < u.dates.length && !found; t += 1) {
        const w = decide(id, p, u, t, ctx());
        if (!w) continue;
        found = true;
        expect(
          Object.values(w).reduce((a, x) => a + x, 0),
          id,
        ).toBeCloseTo(1, 6);
        for (const x of Object.keys(w)) expect([...CATALOG[id].tickers, "BIL"], id).toContain(x);
      }
      expect(found, id).toBe(true);
    }
  });

  it("decides only from the closes up to the day", () => {
    const t = 1500;
    const later = {
      ...u,
      closes: Object.fromEntries(
        Object.entries(u.closes).map(([x, cs]) => [x, cs.map((v, i) => (i > t ? v * 3 : v))]),
      ),
    };
    for (const id of CATALOG_IDS) {
      const p = CATALOG[id].grid[0];
      for (let k = t - 30; k <= t; k += 1)
        expect(decide(id, p, later, k, ctx()), `${id} on ${k}`).toEqual(decide(id, p, u, k, ctx()));
    }
  });
});

describe("the engine", () => {
  it("pays its costs: a fixed mix on flat prices only loses what it trades", () => {
    const u = universe(0);
    const flat = {
      ...u,
      closes: Object.fromEntries(
        Object.keys(u.closes).map((x) => [x, u.closes[x].map(() => 10_000)]),
      ),
    };
    const run = standalone("sixty_forty", 0, flat)!;
    expect(run.values[run.start]).toBeLessThan(1);
    expect(run.values.at(-1)).toBeCloseTo(run.values[run.start], 10);
  });

  it("scores every strategy at every level, out of sample, with the haircut", () => {
    const u = universe();
    const { results, trials } = runCatalog(u);
    // Every strategy at every setting is a trial, and every one is scored at every level.
    expect(trials).toBe(CATALOG_IDS.reduce((a, id) => a + CATALOG[id].grid.length, 0));
    expect(results).toHaveLength(5 * CATALOG_IDS.length);
    for (const r of results) {
      expect(r.dsr).toBeGreaterThanOrEqual(0);
      expect(r.dsr).toBeLessThanOrEqual(1);
      if (r.walk) expect(r.walk.from >= "2020-01-01").toBe(true);
      if (r.recommendable) expect(r.why).toMatch(/beat the mix/);
      else expect(r.why.length).toBeGreaterThan(0);
    }
    // Random prices have no edge to find: the haircut leaves next to nothing recommendable.
    expect(results.filter((r) => r.recommendable).length).toBeLessThanOrEqual(results.length / 10);
    const mix = metricsOver(u, mixReturns(u, 3), 1, u.dates.length - 1)!;
    expect(mix.vol).toBeGreaterThan(0);
  });
});
