import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG, CATALOG_IDS, catalogTickers } from "@/config/strategy-catalog";
import type { Bar } from "@/lib/market/types";
import { catalogMarkdown } from "./catalog-doc";
import { evidenceModule, resultsMarkdown } from "./report";
import { regimeReport, regimesMarkdown } from "./regimes";
import { sensitivity, sensitivityMarkdown } from "./sensitivity";
import { strategyTickers } from "@/config/portfolios";
import { alignUniverse } from "../strategies/engine";
import { catalogCurves } from "./curves";
import {
  alignCatalog,
  metricsOver,
  mixReturns,
  monthAxis,
  pathOnAxis,
  runCatalog,
  standalone,
} from "./engine";
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

  it("an overlay on a steadily rising mix keeps the mix itself", () => {
    const u = universe(0);
    const rising = {
      ...u,
      closes: Object.fromEntries(
        Object.keys(u.closes).map((x) => [x, u.closes[x].map((_, i) => 10_000 * 1.0004 ** i)]),
      ),
    };
    const { results } = runCatalog(rising, ["mix_trend_overlay"]);
    const r = results.find((x) => x.level === 3)!;
    expect(r.walk).not.toBeNull();
    // Always on: the same yearly return as the mix, to a hair (only the first buy's cost).
    expect(r.walk!.cagr).toBeCloseTo(r.mixWalk!.cagr, 3);
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

describe("the write-up", () => {
  it("ranks every level, says what is recommendable, worth watching or not, and why", () => {
    const u = universe();
    const { results, trials } = runCatalog(u, ["sixty_forty", "faber_gtaa5", "rsi2"]);
    const meta = { source: "made-up closes", from: u.dates[0], to: u.dates.at(-1)!, trials };
    const md = resultsMarkdown(results, meta);
    for (const level of ["Very low", "Low", "Medium", "High", "Very high"])
      expect(md).toContain(`## ${level}`);
    expect(md).toMatch(/Recommendable: /);
    expect(md).toMatch(/Worth watching/);
    expect(md).toContain("6 trials were tested");
    const ev = evidenceModule(results, meta);
    expect(ev).toContain("export const CATALOG_EVIDENCE");
    expect(ev).toContain("faber_gtaa5:");
  });
});

describe("the graph's curves", () => {
  it("reads month ends from the last close before the year, compounding from 100", () => {
    const u = universe();
    const axis = monthAxis(u, 2020);
    expect(u.dates[axis[0]] < "2020-01-01").toBe(true);
    expect(u.dates[axis[1]].slice(0, 7)).toBe("2020-01");
    expect(axis.at(-1)).toBe(u.dates.length - 1);
    const flat = u.dates.map(() => 0.01);
    const p = pathOnAxis(flat, axis);
    expect(p[0]).toBe(100);
    expect(p[1]).toBeCloseTo(100 * 1.01 ** (axis[1] - axis[0]), 0);
    // Returns that start later: nothing before, then from 100.
    const late = flat.map((x, t) => (t > axis[5] ? x : Number.NaN));
    const q = pathOnAxis(late, axis);
    expect(q.slice(0, 6).every((x) => x === null)).toBe(true);
    expect(q[6]).toBeCloseTo(100 * 1.01 ** (axis[6] - axis[5]), 0);
  });

  it("writes every strategy, the mix and Jane's pick at every level on one axis", () => {
    const u = universe();
    const run = runCatalog(u, ["faber_gtaa5", "mix_trend_overlay"]);
    const bars = Object.fromEntries(
      strategyTickers().map((t) => [
        t,
        u.dates.map((date, i) => ({ date, closeCents: 10_000 + i + t.length })),
      ]),
    );
    const mod = catalogCurves(u, run, alignUniverse(bars), "made-up closes");
    expect(mod).toContain("export const CATALOG_CURVES");
    const dates = JSON.parse(mod.match(/CATALOG_CURVE_DATES: readonly string\[\] = (.*);/)![1]);
    expect(dates).toEqual(run.axis);
    for (const level of [1, 2, 3, 4, 5]) {
      const row = JSON.parse(mod.match(new RegExp(`^  ${level}: (.*),$`, "m"))![1]);
      expect(row.mix.values).toHaveLength(dates.length);
      expect(row.mix.values[0]).toBe(100);
      expect(row.pick.values).toHaveLength(dates.length);
      expect(row.pick.label.length).toBeGreaterThan(0);
      expect(row.strategies.faber_gtaa5).toHaveLength(dates.length);
    }
  });
});

describe("through past regimes", () => {
  it("reads each strategy at its middle setting through each regime, against the mix", () => {
    const u = universe();
    const rows = regimeReport(u, ["faber_gtaa5", "mix_trend_overlay", "managed_futures"]);
    expect(rows.filter((r) => r.id === "faber_gtaa5")).toHaveLength(5);
    const g = rows.find((r) => r.id === "faber_gtaa5" && r.level === 3)!;
    expect(g.param).toBe(10);
    // The made-up prices start in 2015: 2008 is before every strategy, 2022 inside all of them.
    expect(g.regimes.find((x) => x.label === "2008")!.strategy).toBeNull();
    expect(g.regimes.find((x) => x.label === "2022")!.strategy).not.toBeNull();
    const md = regimesMarkdown(rows, "made-up closes", ["faber_gtaa5"]);
    expect(md).toContain("**Faber GTAA / Ivy 5**");
    expect(md).toContain("### Very high");
  });
});

describe("how much the watch list depends on its setting", () => {
  it("scores each setting fixed since 2020, at Medium and Very high, against the mix", () => {
    const u = universe();
    const rows = sensitivity(u);
    const haa = rows.filter((r) => r.id === "haa");
    expect(haa.map((r) => r.param)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect(new Set(haa.map((r) => r.level))).toEqual(new Set([3, 5]));
    const md = sensitivityMarkdown(rows, "made-up closes");
    expect(md).toMatch(/Ahead of the mix at \d+ of \d+ settings and levels/);
  });
});

describe("the catalog document", () => {
  it.runIf(process.env.CATALOG_DOC_WRITE)("is written from the catalog", () => {
    writeFileSync("docs/backtests/strategy-catalog.md", catalogMarkdown());
  });

  it("is the catalog's own: every strategy with its source and rules", () => {
    expect(readFileSync("docs/backtests/strategy-catalog.md", "utf8")).toBe(catalogMarkdown());
  });
});
