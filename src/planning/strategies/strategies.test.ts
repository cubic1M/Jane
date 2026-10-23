import { describe, expect, it } from "vitest";
import { STRATEGY_ASSET_IDS, STRATEGY_ASSETS, type StrategyAssetId } from "@/config/portfolios";
import { STRATEGY_MIN_SORTINO_GAIN } from "@/config/strategies";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import { alignUniverse, metricsOf, replayStrategy, type Aligned, type Metrics } from "./engine";
import { limitsFor, targetWeights } from "./library";
import {
  BASELINE,
  beatsBaseline,
  candidates,
  decide,
  keyOf,
  selectForLevel,
  startYearResult,
  type CandidateResult,
} from "./select";

// The strategy library: every strategy's weights keep the limits on every day, nothing looks
// ahead, the same closes give the same replay, and the walk-forward choice keeps a strategy
// only when it wins on the later years from every start year.

const LEVELS = [1, 2, 3, 4, 5] as const;
const data = alignUniverse(realFixtureBars())!;
const stocks = (w: Record<string, number | undefined>) =>
  STRATEGY_ASSET_IDS.filter((a) => STRATEGY_ASSETS[a].sleeve === "stocks").reduce(
    (s, a) => s + (w[a] ?? 0),
    0,
  );

describe("each strategy's weights", () => {
  it("sum to 1, are never negative, and keep every cap, on every level and day", () => {
    const days = [1, 30, 130, 260, ...Array.from({ length: 9 }, (_, i) => 300 + i * 270)];
    for (const level of LEVELS) {
      const limits = limitsFor(level);
      for (const c of candidates())
        for (const t of days) {
          const w = targetWeights(c.id, c.params, {
            date: data.dates[t],
            closes: data.closes,
            t,
            limits,
            portfolio: { value: 0.9, peak: 1 },
          });
          const values = Object.values(w) as number[];
          expect(
            values.reduce((s, x) => s + x, 0),
            keyOf(c),
          ).toBeCloseTo(1, 9);
          expect(values.every((x) => x >= 0)).toBe(true);
          for (const a of Object.keys(w) as StrategyAssetId[])
            if (a !== "tbills") expect(w[a]!).toBeLessThanOrEqual(limits.maxAsset + 1e-9);
          expect(w.gold ?? 0).toBeLessThanOrEqual(limits.maxReal + 1e-9);
          expect(stocks(w)).toBeLessThanOrEqual(limits.stocksShare + 1e-9);
          expect(Object.keys(w).every((a) => a in STRATEGY_ASSETS)).toBe(true);
        }
    }
  });

  it("only read the closes before the day: changing later ones changes nothing", () => {
    const t = 1500;
    const later: Aligned["closes"] = Object.fromEntries(
      STRATEGY_ASSET_IDS.map((a) => [a, data.closes[a].map((x, i) => (i >= t ? x * 3 : x))]),
    ) as Aligned["closes"];
    const limits = limitsFor(3);
    for (const c of candidates()) {
      const at = (closes: Aligned["closes"]) =>
        targetWeights(c.id, c.params, {
          date: data.dates[t],
          closes,
          t,
          limits,
          portfolio: { value: 1, peak: 1 },
        });
      expect(at(later), keyOf(c)).toEqual(at(data.closes));
    }
  });

  it("are the level's mix for the static strategy", () => {
    const w = targetWeights(
      "static",
      { rebalance: "band" },
      {
        date: data.dates[10],
        closes: data.closes,
        t: 10,
        limits: limitsFor(4),
        portfolio: { value: 1, peak: 1 },
      },
    );
    const mix = { us_total: 0.5, intl_total: 0.25, bonds_total: 0.2, tbills: 0.05 };
    expect(Object.keys(w).sort()).toEqual(Object.keys(mix).sort());
    for (const [a, x] of Object.entries(mix)) expect(w[a as StrategyAssetId]).toBeCloseTo(x, 12);
  });
});

describe("replayStrategy", () => {
  it("gives the same path for the same closes", () => {
    const limits = limitsFor(4);
    for (const c of [BASELINE, { id: "trend" as const, params: { months: 6 } }]) {
      const a = replayStrategy(data, c, limits, 0, data.dates.length - 1);
      const b = replayStrategy(data, c, limits, 0, data.dates.length - 1);
      expect(a).toEqual(b);
    }
  });

  it("holds its value when nothing moves: only the trading costs of a warm-up switch", () => {
    const flat: Aligned = {
      dates: data.dates.slice(0, 300),
      closes: Object.fromEntries(
        STRATEGY_ASSET_IDS.map((a) => [a, Array(300).fill(10_000)]),
      ) as Aligned["closes"],
    };
    for (const c of candidates()) {
      const r = replayStrategy(flat, c, limitsFor(2), 0, 299)!;
      // A strategy moves from the level's mix to its own weights once it has the history.
      expect(r.metrics.maxDrawdown, keyOf(c)).toBeLessThan(0.001);
    }
  });

  it("works out the metrics from the path", () => {
    // Up 10% over 252 trading days, halfway down 20% from its high; bills flat.
    const path = Array.from({ length: 253 }, (_, i) => ({
      date: `d${String(i).padStart(3, "0")}`,
      valueCents: i === 126 ? 80 : i < 126 ? 100 : 100 + (10 * (i - 126)) / 126,
    }));
    const m = metricsOf(path, Array(253).fill(1), 0.5, 0.001, 3);
    expect(m.cagr).toBeCloseTo(0.1, 9);
    expect(m.maxDrawdown).toBeCloseTo(0.2, 9);
    expect(m.turnover).toBeCloseTo(0.5, 9);
    expect(m.sortino).toBeGreaterThan(0);
  });
});

describe("the walk-forward choice", () => {
  const metrics = (sortino: number, maxDrawdown: number, vol = 0.05): Metrics => ({
    from: "2016-01-04",
    to: "2021-12-31",
    cagr: 0.05,
    vol,
    maxDrawdown,
    sortino,
    turnover: 1,
    costShare: 0,
    rebalances: 10,
  });
  const result = (id: "static" | "trend", train: Metrics, test: Metrics): CandidateResult => {
    const candidate = id === "static" ? BASELINE : { id, params: { months: 6 } };
    return { candidate, key: keyOf(candidate), train, test };
  };
  const limits = limitsFor(3); // 22% worst drop, 11% volatility.

  it("keeps the training pick only when it wins on the later years from every start year", () => {
    // Trend wins training (1.6 against 1.2) and the later years (0.5 against 0.4: past 10%).
    const winning = [
      result("static", metrics(1.2, 0.2), metrics(0.4, 0.21)),
      result("trend", metrics(1.6, 0.08), metrics(0.5, 0.07)),
    ];
    const years = [2016, 2017].map((y) => startYearResult(y, winning, limits)!);
    expect(years.map((y) => [y.pick, y.passed])).toEqual([
      ["trend(months=6)", true],
      ["trend(months=6)", true],
    ]);
    const kept = decide(3, years)!;
    expect(kept.chosenKey).toBe("trend(months=6)");
    expect(kept.why).toMatch(/Sortino 0\.50 against 0\.40/);

    // From 2017 the pick only edges the mix (0.43 against 0.4, under the margin): the mix stays.
    const edging = [
      result("static", metrics(1.2, 0.2), metrics(0.4, 0.21)),
      result("trend", metrics(1.6, 0.08), metrics(0.43, 0.07)),
    ];
    const mixed = decide(3, [years[0], startYearResult(2017, edging, limits)!])!;
    expect(mixed.chosenKey).toBe(keyOf(BASELINE));
    expect(mixed.why).toMatch(/didn't beat the level's mix/);
  });

  it("never picks in training what breaks the budget, and keeps the mix when it is the pick", () => {
    const results = [
      result("static", metrics(1.2, 0.2), metrics(0.4, 0.21)),
      // The best Sortino, but a 30% worst drop: past Medium's 22%.
      result("trend", metrics(2, 0.3), metrics(0.9, 0.1)),
    ];
    const y = startYearResult(2016, results, limits)!;
    expect(y.pick).toBe(keyOf(BASELINE));
    expect(decide(3, [y])!.why).toMatch(/best in training/);
  });

  it("calls a pick better when it is inside the budget and past the margin", () => {
    const base = metrics(0.4, 0.2);
    expect(beatsBaseline(metrics(0.4 * (1 + STRATEGY_MIN_SORTINO_GAIN), 0.1), base, limits)).toBe(
      true,
    );
    expect(beatsBaseline(metrics(0.43, 0.1), base, limits)).toBe(false);
    expect(beatsBaseline(metrics(0.9, 0.25), base, limits)).toBe(false);
    // The mix itself outside the budget: any pick inside it is better.
    expect(beatsBaseline(metrics(0.1, 0.1), metrics(0.4, 0.3), limits)).toBe(true);
  });
});

describe("on real closes (the fixture, docs/backtests/strategies.md)", () => {
  it("chooses the strategy the log records for each level", { timeout: 120_000 }, () => {
    const chosen = LEVELS.map((l) => selectForLevel(data, l)!.chosenKey);
    expect(chosen).toEqual([
      "trend(months=6)",
      "trend(months=6)",
      "trend(months=6)",
      "trend(months=6)",
      "static(rebalance=band)",
    ]);
  });
});
