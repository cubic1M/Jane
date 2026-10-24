import { RISK_LEVELS, TARGET_MIXES, type RiskLevel } from "@/config/investing";
import {
  CATALOG,
  CATALOG_IDS,
  CATALOG_MIN_DSR,
  CATALOG_MIX_FUNDS,
  CATALOG_RISK_SLACK,
  CATALOG_SLEEVE_SHARE,
  CATALOG_SLIPPAGE_BPS,
  CATALOG_TRAIN_END,
  CATALOG_WALK_FROM_YEAR,
  type CatalogId,
} from "@/config/strategy-catalog";
import { RISK_BUDGETS, STRATEGY_TRADE_COST_BPS } from "@/config/strategies";
import type { Bar } from "@/lib/market/types";
import { expectedMaxSharpe, mean, probabilisticSharpe, sd } from "./math";
import { decide, type Bars, type Context, type Universe, type Weights } from "./strategies";

// The strategy catalog replayed (Phase AW, Stage A). Each strategy runs on its own first, as an
// index after costs (trading at the close its rule decides on, paying STRATEGY_TRADE_COST_BPS
// plus CATALOG_SLIPPAGE_BPS on what changes hands). Then, at each risk level:
// - "equity" strategies replace the level mix's US-stocks share;
// - "portfolio" strategies are blended with bills so their volatility matches the level's mix
//   over the years before (never levered);
// - "sleeve" strategies take CATALOG_SLEEVE_SHARE from the mix's bonds.
// Two honest scores, both out of sample: an anchored walk-forward (each year from
// CATALOG_WALK_FROM_YEAR scored with the setting, and blend, the years before chose by
// Sortino) and the fixed split (chosen to CATALOG_TRAIN_END, scored after). The deflated Sharpe
// ratio of the walk-forward's excess over the mix, against the best of every trial tested,
// decides what is recommendable. Pure. A replay of the past, never a forecast.

const DAYS = 252;

export function alignCatalog(
  bars: Readonly<Record<string, readonly Bar[]>>,
  spy?: readonly { date: string; o: number; h: number; l: number; c: number }[],
): Universe | null {
  const master = bars[CATALOG_MIX_FUNDS.us_stocks];
  if (!master || master.length === 0) return null;
  const dates = master.map((b) => b.date);
  const closes: Record<string, number[]> = {};
  for (const [t, list] of Object.entries(bars)) {
    const m = new Map(list.map((b) => [b.date, b.closeCents]));
    // A missing day carries the last close (a holiday on one exchange); 0 before the first.
    let last = 0;
    closes[t] = dates.map((d) => {
      const v = m.get(d);
      if (v) last = v;
      return last;
    });
  }
  const bySpy = new Map((spy ?? []).map((b) => [b.date, b]));
  return {
    dates,
    closes,
    spy: spy
      ? dates.map((d) => {
          const b = bySpy.get(d);
          return b ? ({ o: b.o, h: b.h, l: b.l, c: b.c } satisfies Bars) : null;
        })
      : undefined,
  };
}

export type StandaloneRun = {
  start: number;
  // Its value each day from `start` (NaN before), from 1.
  values: number[];
  turnover: number;
};

// A strategy on its own, after costs.
export function standalone(id: CatalogId, p: number, u: Universe): StandaloneRun | null {
  const cost = (STRATEGY_TRADE_COST_BPS + CATALOG_SLIPPAGE_BPS) / 10_000;
  const units: Record<string, number> = {};
  const ctx: Context = { value: 1, held: {}, memo: {} };
  const values = new Array<number>(u.dates.length).fill(Number.NaN);
  let start = -1;
  let traded = 0;
  for (let t = 0; t < u.dates.length; t += 1) {
    if (start >= 0) {
      ctx.value = Object.entries(units).reduce((s, [x, q]) => s + q * u.closes[x][t], 0);
    }
    const target: Weights | null = decide(id, p, u, t, ctx);
    if (target && (start >= 0 || Object.keys(target).length > 0)) {
      if (start < 0) start = t;
      const tickers = new Set([...Object.keys(units), ...Object.keys(target)]);
      let turnover = 0;
      for (const x of tickers)
        turnover += Math.abs((target[x] ?? 0) * ctx.value - (units[x] ?? 0) * u.closes[x][t]);
      ctx.value -= turnover * cost;
      traded += turnover / ctx.value;
      for (const x of tickers) {
        const w = target[x] ?? 0;
        if (w > 0) units[x] = (w * ctx.value) / u.closes[x][t];
        else delete units[x];
      }
      ctx.held = Object.fromEntries(Object.entries(target).filter(([, w]) => w > 0));
    }
    if (start >= 0) values[t] = ctx.value;
  }
  if (start < 0) return null;
  const years = Math.max(1, u.dates.length - start) / DAYS;
  return { start, values, turnover: traded / years };
}

const daily = (v: readonly number[]) =>
  v.map((x, t) => (t === 0 || !(v[t - 1] > 0) || !(x > 0) ? Number.NaN : x / v[t - 1] - 1));

function mixWeights(level: RiskLevel): Record<string, number> {
  const m = TARGET_MIXES[level];
  return {
    [CATALOG_MIX_FUNDS.us_stocks]: m.us_stocks,
    [CATALOG_MIX_FUNDS.intl_stocks]: m.intl_stocks,
    [CATALOG_MIX_FUNDS.bonds]: m.bonds,
    [CATALOG_MIX_FUNDS.cash]: m.cash,
  };
}

// The level's own mix, daily (kept on its weights).
export function mixReturns(u: Universe, level: RiskLevel): number[] {
  const w = mixWeights(level);
  const r = Object.fromEntries(Object.keys(w).map((x) => [x, daily(u.closes[x])]));
  return u.dates.map((_, t) => Object.entries(w).reduce((s, [x, wi]) => s + wi * r[x][t], 0));
}

// The level's portfolio with this strategy in it, daily (k: the blend with bills).
function levelReturns(
  u: Universe,
  id: CatalogId,
  s: readonly number[],
  level: RiskLevel,
  k: number,
) {
  const kind = CATALOG[id].kind;
  const bills = daily(u.closes[CATALOG_MIX_FUNDS.cash]);
  if (kind === "portfolio") return s.map((x, t) => k * x + (1 - k) * bills[t]);
  const w = mixWeights(level);
  const r = Object.fromEntries(Object.keys(w).map((x) => [x, daily(u.closes[x])]));
  if (kind === "equity") {
    const us = w[CATALOG_MIX_FUNDS.us_stocks];
    return u.dates.map(
      (_, t) =>
        us * s[t] +
        Object.entries(w)
          .filter(([x]) => x !== CATALOG_MIX_FUNDS.us_stocks)
          .reduce((a, [x, wi]) => a + wi * r[x][t], 0),
    );
  }
  const move = Math.min(CATALOG_SLEEVE_SHARE, w[CATALOG_MIX_FUNDS.bonds]);
  return u.dates.map(
    (_, t) =>
      move * s[t] +
      Object.entries(w).reduce(
        (a, [x, wi]) => a + (x === CATALOG_MIX_FUNDS.bonds ? wi - move : wi) * r[x][t],
        0,
      ),
  );
}

export type CatalogMetrics = {
  from: string;
  to: string;
  cagr: number;
  maxDrawdown: number;
  vol: number;
  sortino: number;
  calmar: number;
  sharpe: number;
  worstYear: number;
};

// Metrics of daily returns over [i0, i1], bills as the hurdle.
export function metricsOver(
  u: Universe,
  r: readonly number[],
  i0: number,
  i1: number,
): CatalogMetrics | null {
  const bills = daily(u.closes[CATALOG_MIX_FUNDS.cash]);
  const xs: number[] = [];
  const bs: number[] = [];
  for (let t = i0; t <= i1; t += 1) {
    if (!Number.isFinite(r[t])) continue;
    xs.push(r[t]);
    bs.push(Number.isFinite(bills[t]) ? bills[t] : 0);
  }
  if (xs.length < 60) return null;
  let v = 1;
  let peak = 1;
  let dd = 0;
  const byYear = new Map<string, number>();
  let k = 0;
  for (let t = i0; t <= i1; t += 1) {
    if (!Number.isFinite(r[t])) continue;
    v *= 1 + r[t];
    peak = Math.max(peak, v);
    dd = Math.max(dd, 1 - v / peak);
    const y = u.dates[t].slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 1) * (1 + xs[k]));
    k += 1;
  }
  const years = xs.length / DAYS;
  const cagr = v ** (1 / years) - 1;
  const billsCagr = bs.reduce((a, x) => a * (1 + x), 1) ** (1 / years) - 1;
  const ex = xs.map((x, i) => x - bs[i]);
  const downside = Math.sqrt(
    xs.reduce((a, x, i) => a + Math.min(0, x - bs[i]) ** 2, 0) / xs.length,
  );
  return {
    from: u.dates[i0],
    to: u.dates[i1],
    cagr,
    maxDrawdown: dd,
    vol: sd(xs) * Math.sqrt(DAYS),
    sortino: downside > 0 ? (cagr - billsCagr) / (downside * Math.sqrt(DAYS)) : 0,
    calmar: dd > 0 ? cagr / dd : 0,
    sharpe: sd(ex) > 0 ? (mean(ex) / sd(ex)) * Math.sqrt(DAYS) : 0,
    worstYear: Math.min(...[...byYear.values()].map((x) => x - 1)),
  };
}

const indexOfDate = (u: Universe, d: string) => {
  const i = u.dates.findIndex((x) => x >= d);
  return i < 0 ? u.dates.length : i;
};

export type CatalogResult = {
  id: CatalogId;
  level: RiskLevel;
  // The walk-forward's choices: from each year, the setting (and the bills blend).
  chosen: { year: number; param: number; k: number }[];
  walk: CatalogMetrics | null;
  later: CatalogMetrics | null;
  mixWalk: CatalogMetrics | null;
  mixLater: CatalogMetrics | null;
  fixedParam: number | null;
  turnover: number;
  // The walk-forward's excess over the mix: its yearly Sharpe ratio, and the deflated Sharpe
  // ratio after the haircut for every trial tested.
  excessSharpe: number;
  dsr: number;
  recommendable: boolean;
  why: string;
  // The walk-forward's path, 40 points from 100.
  curve: number[];
};

type Trial = { id: CatalogId; p: number; s: number[]; run: StandaloneRun };

function blend(
  u: Universe,
  s: readonly number[],
  level: RiskLevel,
  mix: readonly number[],
  i0: number,
  i1: number,
) {
  const a: number[] = [];
  const b: number[] = [];
  for (let t = i0; t <= i1; t += 1)
    if (Number.isFinite(s[t]) && Number.isFinite(mix[t])) {
      a.push(s[t]);
      b.push(mix[t]);
    }
  if (a.length < DAYS) return null;
  return Math.min(1, sd(b) / Math.max(1e-9, sd(a)));
}

// One strategy at one level: walk-forward and the fixed split.
function evaluate(u: Universe, trials: readonly Trial[], level: RiskLevel, mix: readonly number[]) {
  const id = trials[0].id;
  const kind = CATALOG[id].kind;
  const last = u.dates.length - 1;
  const lastYear = Number(u.dates[last].slice(0, 4));
  const choose = (i1: number) => {
    let best: { trial: Trial; k: number; score: number } | null = null;
    for (const trial of trials) {
      const i0 = trial.run.start + 1;
      if (i1 - i0 < DAYS) continue;
      const k = kind === "portfolio" ? blend(u, trial.s, level, mix, i0, i1) : 1;
      if (k === null) continue;
      const m = metricsOver(u, levelReturns(u, id, trial.s, level, k), i0, i1);
      if (m && (!best || m.sortino > best.score)) best = { trial, k, score: m.sortino };
    }
    return best;
  };
  const walk = new Array<number>(u.dates.length).fill(Number.NaN);
  const chosen: CatalogResult["chosen"] = [];
  for (let y = CATALOG_WALK_FROM_YEAR; y <= lastYear; y += 1) {
    const i0 = indexOfDate(u, `${y}-01-01`);
    const i1 = Math.min(last, indexOfDate(u, `${y + 1}-01-01`) - 1);
    if (i0 > last) break;
    const pick = choose(i0 - 1);
    if (!pick) continue;
    chosen.push({ year: y, param: pick.trial.p, k: Math.round(pick.k * 1000) / 1000 });
    const r = levelReturns(u, id, pick.trial.s, level, pick.k);
    for (let t = i0; t <= i1; t += 1) walk[t] = r[t];
  }
  const walkFrom = walk.findIndex((x) => Number.isFinite(x));
  const fixed = choose(indexOfDate(u, `${CATALOG_TRAIN_END.slice(0, 4)}-12-31`) - 1);
  const laterFrom = indexOfDate(u, `${Number(CATALOG_TRAIN_END.slice(0, 4)) + 1}-01-01`);
  const later = fixed
    ? metricsOver(u, levelReturns(u, id, fixed.trial.s, level, fixed.k), laterFrom, last)
    : null;
  return {
    walk,
    walkFrom,
    chosen,
    walkMetrics: walkFrom >= 0 ? metricsOver(u, walk, walkFrom, last) : null,
    mixWalk: walkFrom >= 0 ? metricsOver(u, mix, walkFrom, last) : null,
    later,
    mixLater: metricsOver(u, mix, laterFrom, last),
    fixedParam: fixed?.trial.p ?? null,
    turnover: mean(trials.map((t) => t.run.turnover)),
  };
}

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

export function runCatalog(u: Universe, ids: readonly CatalogId[] = CATALOG_IDS) {
  const trials: Trial[] = [];
  for (const id of ids)
    for (const p of CATALOG[id].grid) {
      const run = standalone(id, p, u);
      if (run) trials.push({ id, p, run, s: daily(run.values) });
    }
  const results: CatalogResult[] = [];
  for (const level of [1, 2, 3, 4, 5] as const) {
    const mix = mixReturns(u, level);
    const evals = ids.flatMap((id) => {
      const mine = trials.filter((t) => t.id === id);
      return mine.length > 0 ? [{ id, e: evaluate(u, mine, level, mix) }] : [];
    });
    // The haircut: how much the trials' excess Sharpe ratios vary, over the whole history each
    // has, at their own settings, and how many there were.
    const trialSharpes = trials.flatMap((trial) => {
      const r = levelReturns(u, trial.id, trial.s, level, 1);
      const ex = r.map((x, t) => x - mix[t]).filter((x) => Number.isFinite(x));
      return ex.length > DAYS && sd(ex) > 0 ? [mean(ex) / sd(ex)] : [];
    });
    const sharpeVar = sd(trialSharpes) ** 2;
    const sr0 = expectedMaxSharpe(trials.length, sharpeVar);
    for (const { id, e } of evals) {
      const ex = e.walk.map((x, t) => x - mix[t]).filter((x) => Number.isFinite(x));
      const dsr = probabilisticSharpe(ex, sr0);
      const excessSharpe = ex.length > 1 && sd(ex) > 0 ? (mean(ex) / sd(ex)) * Math.sqrt(DAYS) : 0;
      const budget = RISK_BUDGETS[level];
      const reasons: string[] = [];
      const w = e.walkMetrics;
      const fullWalk = e.chosen[0]?.year === CATALOG_WALK_FROM_YEAR;
      if (!w || !fullWalk)
        reasons.push(`not enough history to choose on before ${CATALOG_WALK_FROM_YEAR}`);
      if (w && e.mixWalk && w.sortino <= e.mixWalk.sortino)
        reasons.push(`less return for its risk than the mix since ${CATALOG_WALK_FROM_YEAR}`);
      if (e.later && e.mixLater && e.later.sortino <= e.mixLater.sortino)
        reasons.push("less return for its risk than the mix from 2022");
      if (
        w &&
        e.mixWalk &&
        w.maxDrawdown > Math.max(budget.maxDrawdown, e.mixWalk.maxDrawdown) + CATALOG_RISK_SLACK
      )
        reasons.push(
          `fell further (${pct(w.maxDrawdown)}) than ${RISK_LEVELS[level].label} allows`,
        );
      if (w && e.mixWalk && w.vol > Math.max(budget.volCap, e.mixWalk.vol) + CATALOG_RISK_SLACK)
        reasons.push(`more volatile (${pct(w.vol)}) than ${RISK_LEVELS[level].label} allows`);
      if (dsr < CATALOG_MIN_DSR)
        reasons.push(
          `after the haircut for ${trials.length} trials, only ${Math.round(dsr * 100)}% likely to beat the mix (needs ${Math.round(CATALOG_MIN_DSR * 100)}%)`,
        );
      const curve: number[] = [];
      if (e.walkFrom >= 0) {
        let v = 100;
        const path = e.walk.slice(e.walkFrom).map((x) => (v *= 1 + (Number.isFinite(x) ? x : 0)));
        for (let i = 0; i < 40; i += 1)
          curve.push(Math.round(path[Math.round((i * (path.length - 1)) / 39)] * 10) / 10);
      }
      results.push({
        id,
        level,
        chosen: e.chosen,
        walk: w,
        later: e.later,
        mixWalk: e.mixWalk,
        mixLater: e.mixLater,
        fixedParam: e.fixedParam,
        turnover: e.turnover,
        excessSharpe,
        dsr,
        recommendable: reasons.length === 0,
        why:
          reasons.length === 0
            ? "beat the mix after the haircut, inside the risk budget"
            : reasons.join("; "),
        curve,
      });
    }
  }
  return { results, trials: trials.length };
}
