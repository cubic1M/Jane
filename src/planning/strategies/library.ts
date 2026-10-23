import type { RiskLevel } from "@/config/investing";
import {
  MODEL_PORTFOLIOS,
  STRATEGY_ASSET_IDS,
  STRATEGY_ASSETS,
  stocksShare,
  type StrategyAssetId,
} from "@/config/portfolios";
import {
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  RISK_BUDGETS,
  STRATEGY_MAX_ASSET,
  STRATEGY_MAX_REAL,
  type StrategyId,
} from "@/config/strategies";
import { covariance, projectCapped, sma, stdev, trailingReturn, vol } from "./stats";
import type { LevelLimits, Params, Strategy, StrategyContext, Weights } from "./types";

// The strategy library (Phase AW, Stage A). Each strategy is a pure function of the day, the
// closes known before it, the level's limits and the portfolio's own high, returning target
// weights over the universe. Every result goes through `finish`: no negatives, no fund over its
// cap, no more stocks than the level's mix, gold capped, what is left in bills, summing to 1.
// No leverage, no shorting, no options. Every number is in src/config/strategies.ts.

const IDS = STRATEGY_ASSET_IDS;
const sleeve = (a: StrategyAssetId) => STRATEGY_ASSETS[a].sleeve;
const STOCKS = IDS.filter((a) => sleeve(a) === "stocks");
// The stock funds a strategy picks among (the total international fund overlaps the two parts).
const STOCK_PICKS: readonly StrategyAssetId[] = [
  "us_total",
  "us_small_value",
  "intl_developed",
  "emerging",
  "reits",
];
const DEFENSIVE: readonly StrategyAssetId[] = [
  "treasury_short",
  "treasury_mid",
  "treasury_long",
  "tips",
  "gold",
];
const sum = (w: Weights, ids: readonly StrategyAssetId[] = IDS) =>
  ids.reduce((s, a) => s + (w[a] ?? 0), 0);

export function limitsFor(level: RiskLevel): LevelLimits {
  const m = MODEL_PORTFOLIOS[level].weights;
  return {
    level,
    base: {
      us_total: m.us_stocks,
      intl_total: m.intl_stocks,
      bonds_total: m.bonds,
      tbills: m.cash,
    },
    stocksShare: stocksShare(level),
    maxDrawdown: RISK_BUDGETS[level].maxDrawdown,
    volCap: RISK_BUDGETS[level].volCap,
    maxAsset: STRATEGY_MAX_ASSET,
    maxReal: STRATEGY_MAX_REAL,
  };
}

// Every strategy's last step: the limits, whatever the strategy asked for.
export function finish(raw: Weights, limits: LevelLimits): Weights {
  const w: Weights = {};
  for (const a of IDS) {
    const x = raw[a] ?? 0;
    w[a] = Number.isFinite(x) && x > 0 ? x : 0;
  }
  const total = sum(w);
  if (total <= 0) return { tbills: 1 };
  for (const a of IDS) w[a] = w[a]! / total;
  // No fund past its cap (bills are cash), gold capped, stocks no more than the level's share.
  for (const a of IDS) if (a !== "tbills") w[a] = Math.min(w[a]!, limits.maxAsset);
  const real = sum(w, ["gold"]);
  if (real > limits.maxReal) w.gold = limits.maxReal;
  const stocks = sum(w, STOCKS);
  if (stocks > limits.stocksShare)
    for (const a of STOCKS) w[a] = (w[a]! * limits.stocksShare) / stocks;
  w.tbills = Math.max(
    0,
    1 -
      sum(
        w,
        IDS.filter((a) => a !== "tbills"),
      ),
  );
  const out: Weights = {};
  for (const a of IDS) if (w[a]! > 1e-9) out[a] = w[a];
  return out;
}

const scale = (w: Weights, ids: readonly StrategyAssetId[], k: number): Weights => {
  const out = { ...w };
  for (const a of ids) if (out[a] !== undefined) out[a] = out[a]! * k;
  return out;
};

const volOf = (ctx: StrategyContext, a: StrategyAssetId, window: number) =>
  vol(ctx.closes[a], ctx.t, window, DAYS_PER_YEAR);

// Split `total` across the funds in inverse proportion to their volatility; equal when unknown.
function inverseVolSplit(
  ctx: StrategyContext,
  ids: readonly StrategyAssetId[],
  window: number,
  total: number,
) {
  const inv = ids.map((a) => {
    const v = volOf(ctx, a, window);
    return v && v > 0 ? 1 / v : null;
  });
  const known = inv.every((x) => x !== null);
  const parts = known ? (inv as number[]) : ids.map(() => 1);
  const s = parts.reduce((x, y) => x + y, 0);
  return Object.fromEntries(ids.map((a, i) => [a, (total * parts[i]) / s])) as Weights;
}

const STATIC: Strategy = { id: "static", weights: (ctx) => ctx.limits.base };

const INVERSE_VOL: Strategy = {
  id: "inverse_vol",
  weights(ctx, p) {
    const window = Number(p.windowDays);
    const { stocksShare: s, base } = ctx.limits;
    const cash = base.tbills ?? 0;
    if (p.scope === "all")
      return {
        ...inverseVolSplit(ctx, [...STOCK_PICKS, ...DEFENSIVE], window, 1 - cash),
        tbills: cash,
      };
    return {
      ...inverseVolSplit(ctx, STOCK_PICKS, window, s),
      ...inverseVolSplit(ctx, DEFENSIVE, window, 1 - s - cash),
      tbills: cash,
    };
  },
};

const VOL_TARGET: Strategy = {
  id: "vol_target",
  weights(ctx, p) {
    const { base, volCap, stocksShare: s } = ctx.limits;
    if (s <= 0) return base;
    // The stocks' own blend: its daily returns over the window.
    const window = Number(p.windowDays);
    if (ctx.t - 1 < window) return base;
    const parts = STOCKS.filter((a) => (base[a] ?? 0) > 0);
    const daily: number[] = [];
    for (let i = ctx.t - window; i < ctx.t; i += 1) {
      daily.push(
        parts.reduce(
          (r, a) => r + ((base[a] ?? 0) / s) * (ctx.closes[a][i] / ctx.closes[a][i - 1] - 1),
          0,
        ),
      );
    }
    const stockVol = stdev(daily) * Math.sqrt(DAYS_PER_YEAR);
    const k = stockVol > 0 ? Math.min(1, volCap / (s * stockVol)) : 1;
    const w = scale(base, parts, k);
    return { ...w, tbills: (base.tbills ?? 0) + s * (1 - k) };
  },
};

const TREND: Strategy = {
  id: "trend",
  weights(ctx, p) {
    const window = Number(p.months) * DAYS_PER_MONTH;
    const w: Weights = { ...ctx.limits.base };
    for (const a of IDS) {
      if (a === "tbills" || !w[a]) continue;
      const avg = sma(ctx.closes[a], ctx.t, window);
      if (avg !== null && ctx.closes[a][ctx.t - 1] < avg) {
        w.tbills = (w.tbills ?? 0) + w[a]!;
        w[a] = 0;
      }
    }
    return w;
  },
};

const DUAL_MOMENTUM: Strategy = {
  id: "dual_momentum",
  weights(ctx, p) {
    const lookback = Number(p.lookbackDays);
    const { base, stocksShare: s, maxAsset } = ctx.limits;
    const bills = trailingReturn(ctx.closes.tbills, ctx.t, lookback);
    const ranked: { a: StrategyAssetId; r: number }[] = [];
    for (const a of STOCK_PICKS) {
      if (a === "reits") continue;
      const r = trailingReturn(ctx.closes[a], ctx.t, lookback);
      if (r !== null) ranked.push({ a, r });
    }
    ranked.sort((x, y) => y.r - x.r);
    if (bills === null || ranked.length === 0) return base;
    const defensive = { bonds_total: base.bonds_total ?? 0, tbills: base.tbills ?? 0 };
    // Absolute momentum: even the best stock fund trails bills, so the stock sleeve steps aside.
    if (ranked[0].r <= bills) {
      const mid = Math.min(s, maxAsset);
      return { ...defensive, treasury_mid: mid, treasury_short: s - mid };
    }
    // Relative momentum: the best, and the next best above bills for what its cap leaves.
    const first = Math.min(s, maxAsset);
    const next = ranked[1] && ranked[1].r > bills ? ranked[1].a : "treasury_mid";
    return { ...defensive, [ranked[0].a]: first, [next]: s - first };
  },
};

const MIN_VARIANCE: Strategy = {
  id: "min_variance",
  weights(ctx, p) {
    const window = Number(p.windowDays);
    const { base, stocksShare: s, maxAsset } = ctx.limits;
    const cash = base.tbills ?? 0;
    const ids = [...STOCK_PICKS, ...DEFENSIVE];
    const cov = covariance(
      ids.map((a) => ctx.closes[a]),
      ctx.t,
      window,
    );
    if (!cov) return base;
    // Projected gradient descent on w'Σw, each sleeve held to its share and every fund to its cap.
    const nS = STOCK_PICKS.length;
    let w = ids.map((_, i) => (i < nS ? s / nS : (1 - s - cash) / DEFENSIVE.length));
    const trace = cov.reduce((t, row, i) => t + row[i], 0);
    const step = 0.5 / Math.max(trace, 1e-12);
    for (let it = 0; it < 400; it += 1) {
      const grad = cov.map((row) => row.reduce((g, c, j) => g + c * w[j], 0));
      const next = w.map((x, i) => x - step * grad[i]);
      w = [
        ...projectCapped(next.slice(0, nS), s, maxAsset),
        ...projectCapped(next.slice(nS), 1 - s - cash, maxAsset),
      ];
    }
    return { ...Object.fromEntries(ids.map((a, i) => [a, w[i]])), tbills: cash };
  },
};

const CPPI: Strategy = {
  id: "cppi",
  weights(ctx, p) {
    const { base, stocksShare: s, maxDrawdown } = ctx.limits;
    if (s <= 0) return base;
    const floor = ctx.portfolio.peak * (1 - maxDrawdown);
    const cushion = Math.max(0, ctx.portfolio.value - floor) / ctx.portfolio.value;
    const stocks = Math.min(s, Number(p.multiplier) * cushion);
    const k = stocks / s;
    const w = scale(base, STOCKS, k);
    // What leaves stocks goes to bonds and bills in the level's own proportion.
    const def = (base.bonds_total ?? 0) + (base.tbills ?? 0);
    const freed = s - stocks;
    const bondShare = def > 0 ? (base.bonds_total ?? 0) / def : 0;
    return {
      ...w,
      bonds_total: (base.bonds_total ?? 0) + freed * bondShare,
      tbills: (base.tbills ?? 0) + freed * (1 - bondShare),
    };
  },
};

export const STRATEGIES: Readonly<Record<StrategyId, Strategy>> = {
  static: STATIC,
  inverse_vol: INVERSE_VOL,
  vol_target: VOL_TARGET,
  trend: TREND,
  dual_momentum: DUAL_MOMENTUM,
  min_variance: MIN_VARIANCE,
  cppi: CPPI,
};

// A strategy's weights for the day, through the limits.
export function targetWeights(id: StrategyId, params: Params, ctx: StrategyContext): Weights {
  return finish(STRATEGIES[id].weights(ctx, params), ctx.limits);
}
