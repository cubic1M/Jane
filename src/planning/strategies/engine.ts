import {
  AUTOPILOT_LIMITS,
  STRATEGY_ASSET_IDS,
  STRATEGY_ASSETS,
  type StrategyAssetId,
} from "@/config/portfolios";
import { DAYS_PER_YEAR, STRATEGY_TRADE_COST_BPS } from "@/config/strategies";
import type { Bar } from "@/lib/market/types";
import { worstDropOf, type PathPoint } from "../backtest";
import { targetWeights } from "./library";
import type { Candidate, LevelLimits, Weights } from "./types";

// Replays one strategy over aligned daily closes (Phase AW, Stage A). Each rebalance day the
// strategy is asked for its weights from the closes before that day, and the portfolio trades to
// them at that day's close, paying STRATEGY_TRADE_COST_BPS on what changes hands. Fund costs are
// already inside adjusted closes. Pure: the same closes always give the same path. A replay of
// the past, never a forecast; practice money only.

export type Aligned = {
  dates: string[];
  closes: Record<StrategyAssetId, number[]>;
};

// The days every universe fund has a close, with each fund's closes on them.
export function alignUniverse(bars: Readonly<Record<string, readonly Bar[]>>): Aligned | null {
  const maps = STRATEGY_ASSET_IDS.map(
    (a) => new Map((bars[STRATEGY_ASSETS[a].ticker] ?? []).map((b) => [b.date, b.closeCents])),
  );
  if (maps.some((m) => m.size === 0)) return null;
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => (m.get(d) ?? 0) > 0)).sort();
  const closes = Object.fromEntries(
    STRATEGY_ASSET_IDS.map((a, i) => [a, dates.map((d) => maps[i].get(d)!)]),
  ) as Record<StrategyAssetId, number[]>;
  return { dates, closes };
}

export type Metrics = {
  from: string;
  to: string;
  // Yearly growth, the yearly volatility of daily returns, the deepest fall from a high.
  cagr: number;
  vol: number;
  maxDrawdown: number;
  // Return above bills for each unit of downside volatility (below bills' daily return).
  sortino: number;
  // What changed hands each year, as a share of the portfolio, and what it cost in all.
  turnover: number;
  costShare: number;
  rebalances: number;
};

export type Replay = { path: PathPoint[]; metrics: Metrics; last: Weights };

const START = 1_000_000;
const rebalanceDue = (policy: string, prev: string, date: string) =>
  policy === "monthly" || policy === "signal"
    ? prev.slice(0, 7) !== date.slice(0, 7)
    : policy === "quarterly"
      ? Math.floor((Number(prev.slice(5, 7)) - 1) / 3) !==
          Math.floor((Number(date.slice(5, 7)) - 1) / 3) || prev.slice(0, 4) !== date.slice(0, 4)
      : policy === "annual"
        ? prev.slice(0, 4) !== date.slice(0, 4)
        : false;

export function metricsOf(
  path: readonly PathPoint[],
  bills: readonly number[],
  turnover: number,
  cost: number,
  rebalances: number,
): Metrics {
  const n = path.length - 1;
  const years = Math.max(n, 1) / DAYS_PER_YEAR;
  const r = path.slice(1).map((p, i) => p.valueCents / path[i].valueCents - 1);
  const billsDaily = bills.slice(1).map((b, i) => b / bills[i] - 1);
  const mar = billsDaily.reduce((s, x) => s + x, 0) / Math.max(1, billsDaily.length);
  const mean = r.reduce((s, x) => s + x, 0) / Math.max(1, r.length);
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, r.length - 1);
  const downside = Math.sqrt(
    r.reduce((s, x) => s + Math.min(0, x - mar) ** 2, 0) / Math.max(1, r.length),
  );
  const cagr = (path[n].valueCents / path[0].valueCents) ** (1 / years) - 1;
  const billsCagr = (bills[bills.length - 1] / bills[0]) ** (1 / years) - 1;
  return {
    from: path[0].date,
    to: path[n].date,
    cagr,
    vol: Math.sqrt(variance * DAYS_PER_YEAR),
    maxDrawdown: Math.max(0, -worstDropOf(path).fraction),
    sortino: downside > 0 ? (cagr - billsCagr) / (downside * Math.sqrt(DAYS_PER_YEAR)) : 0,
    turnover: turnover / years,
    costShare: cost,
    rebalances,
  };
}

// The replay from index `from` to `to` (inclusive), starting with START in the strategy's weights.
export function replayStrategy(
  data: Aligned,
  candidate: Candidate,
  limits: LevelLimits,
  from: number,
  to: number,
): Replay | null {
  if (to - from < 2) return null;
  const { closes, dates } = data;
  const cost = STRATEGY_TRADE_COST_BPS / 10_000;
  const policy = candidate.id === "static" ? String(candidate.params.rebalance) : "signal";
  const ids = STRATEGY_ASSET_IDS;
  const units = Object.fromEntries(ids.map((a) => [a, 0])) as Record<StrategyAssetId, number>;
  let value = START;
  let peak = START;
  let target: Weights = {};
  let traded = 0;
  let costs = 0;
  let rebalances = 0;
  const path: PathPoint[] = [];

  const trade = (t: number) => {
    target = targetWeights(candidate.id, candidate.params, {
      date: dates[t],
      closes,
      t,
      limits,
      portfolio: { value, peak },
    });
    const turnover = ids.reduce(
      (s, a) => s + Math.abs((target[a] ?? 0) * value - units[a] * closes[a][t]),
      0,
    );
    const paid = turnover * cost;
    traded += turnover / value;
    costs += paid / value;
    value -= paid;
    for (const a of ids) units[a] = ((target[a] ?? 0) * value) / closes[a][t];
    rebalances += 1;
  };

  for (let t = from; t <= to; t += 1) {
    if (t > from) value = ids.reduce((s, a) => s + units[a] * closes[a][t], 0);
    peak = Math.max(peak, value);
    if (t === from) trade(t);
    else if (rebalanceDue(policy, dates[t - 1], dates[t])) trade(t);
    else if (policy === "band") {
      const off = ids.some(
        (a) =>
          Math.abs((units[a] * closes[a][t]) / value - (target[a] ?? 0)) >
          AUTOPILOT_LIMITS.rebalanceBand,
      );
      if (off) trade(t);
    }
    path.push({ date: dates[t], valueCents: value });
  }
  return {
    path,
    metrics: metricsOf(path, closes.tbills.slice(from, to + 1), traded, costs, rebalances - 1),
    last: target,
  };
}

// The index range of the dates within [fromDate, toDate] (toDate null: to the end), or null.
export function rangeOf(data: Aligned, fromDate: string, toDate: string | null) {
  const from = data.dates.findIndex((d) => d >= fromDate);
  let to = data.dates.length - 1;
  if (toDate) while (to >= 0 && data.dates[to] > toDate) to -= 1;
  return from < 0 || to - from < 2 ? null : { from, to };
}
