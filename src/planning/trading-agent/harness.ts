import {
  AGENT_FOLDS,
  AGENT_MIN_DSR,
  AGENT_TRAIN_SHARE,
  type AgentCosts,
} from "@/config/trading-agent";
import { expectedMaxSharpe, mean, probabilisticSharpe, sd } from "@/planning/catalog/math";
import { runOnTimeline, startState } from "./engine";
import type { AgentTrade, Policy, Timeline } from "./types";

// The agent's replay over past bars (docs/backtests/intraday.md): each strategy run by the same
// loop as the live agent (./engine.ts), so every number here is what the agent would have done,
// with the same fills at the next bar's open after costs. Settings are chosen walk-forward (the
// first AGENT_TRAIN_SHARE of bars only train; each later fold is scored with the setting the bars
// before it chose by Sharpe ratio), and a strategy is said to beat just holding only after the
// catalog's haircut for how many were tried (the deflated Sharpe ratio). Pure. A replay of the
// past, never a forecast.

const YEAR_MS = 365.25 * 86_400_000;
const START_CENTS = 1_000_000;

export type Metrics = {
  from: string;
  to: string;
  bars: number;
  cagr: number;
  maxDrawdown: number;
  // Yearly, from bar returns (no cash hurdle).
  sharpe: number;
  // Sells that came out above what was paid, after costs, of all sells; null with none.
  winRate: number | null;
  trades: number;
  tradesPerYear: number;
  // What changed hands in a year, as a share of the account's average value.
  turnover: number;
  costsCents: number;
};

export type Replay = {
  times: string[];
  values: number[];
  trades: AgentTrade[];
};

// One strategy at one setting over a whole timeline, from $10,000.
export function replay(
  policy: Policy,
  param: number,
  tl: Timeline,
  costs: AgentCosts,
  cash: string,
  minutes: number,
): Replay {
  const run = runOnTimeline(startState(START_CENTS), tl, [], {
    policy,
    param,
    costs,
    cash,
    minutes,
  });
  return { times: tl.times, values: run.values.map((v) => v.valueCents), trades: run.trades };
}

// Just holding one ticker: bought at the first bar's open after costs, never sold.
export function holdReplay(ticker: string, tl: Timeline, costs: AgentCosts): Replay {
  const first = tl.close[ticker].findIndex((c) => c > 0);
  const edge = (costs.halfSpreadBps + costs.slippageBps) / 10_000;
  const fee = costs.feeBps / 10_000;
  const values = tl.times.map(() => START_CENTS);
  if (first < 0) return { times: tl.times, values, trades: [] };
  const px = (tl.open[ticker][first] || tl.close[ticker][first]) * (1 + edge);
  const qty = START_CENTS / (1 + fee) / px;
  for (let i = first; i < tl.times.length; i += 1) values[i] = qty * tl.close[ticker][i];
  return { times: tl.times, values, trades: [] };
}

export const barReturns = (values: readonly number[]) =>
  values.map((v, i) => (i === 0 || !(values[i - 1] > 0) ? 0 : v / values[i - 1] - 1));

// Sells above what was paid (by each ticker's average cost, costs included), of all sells.
function winRateOf(trades: readonly AgentTrade[]): number | null {
  const held: Record<string, { q: number; cost: number }> = {};
  let wins = 0;
  let sells = 0;
  for (const t of trades) {
    const h = (held[t.ticker] ??= { q: 0, cost: 0 });
    if (t.side === "buy") {
      h.q += t.quantity;
      h.cost += t.amountCents + t.feeCents;
    } else if (h.q > 0) {
      const avg = h.cost / h.q;
      const q = Math.min(t.quantity, h.q);
      const got = ((t.amountCents - t.feeCents) * q) / t.quantity;
      sells += 1;
      if (got > avg * q) wins += 1;
      h.cost -= avg * q;
      h.q -= q;
    }
  }
  return sells > 0 ? wins / sells : null;
}

// Metrics over bars i0..i1 of returns `r` (the values the returns came from for turnover).
export function metricsOf(
  times: readonly string[],
  r: readonly number[],
  i0: number,
  i1: number,
  trades: readonly AgentTrade[],
  averageValue: number,
): Metrics {
  let v = 1;
  let peak = 1;
  let dd = 0;
  const xs: number[] = [];
  for (let i = i0; i <= i1; i += 1) {
    v *= 1 + r[i];
    peak = Math.max(peak, v);
    dd = Math.max(dd, 1 - v / peak);
    xs.push(r[i]);
  }
  const years = Math.max(1e-9, (Date.parse(times[i1]) - Date.parse(times[i0])) / YEAR_MS);
  const perYear = xs.length / years;
  const s = sd(xs);
  const inside = trades.filter((t) => t.at >= times[i0] && t.at <= times[i1]);
  const traded = inside.reduce((a, t) => a + t.amountCents, 0);
  return {
    from: times[i0],
    to: times[i1],
    bars: xs.length,
    cagr: v ** (1 / years) - 1,
    maxDrawdown: dd,
    sharpe: s > 0 ? (mean(xs) / s) * Math.sqrt(perYear) : 0,
    winRate: winRateOf(inside),
    trades: inside.length,
    tradesPerYear: inside.length / years,
    turnover: averageValue > 0 ? traded / averageValue / years : 0,
    costsCents: inside.reduce((a, t) => a + t.feeCents + t.spreadCents, 0),
  };
}

export type Verdict = "beats_hold" | "behind_hold" | "loses_money";

export type StrategyResult = {
  key: string;
  label: string;
  // The setting each fold used, in order.
  chosen: number[];
  walk: Metrics;
  hold: Metrics;
  // The walk-forward's yearly growth above just holding's, in points.
  excessCagr: number;
  // The deflated Sharpe ratio of its bar returns over holding's, after the haircut.
  dsr: number;
  verdict: Verdict;
};

export type GroupResult = {
  market: string;
  interval: string;
  from: string;
  to: string;
  bars: number;
  trials: number;
  results: StrategyResult[];
  hold: Metrics;
};

type Trial = { policy: Policy; param: number; run: Replay; r: number[] };

// Every policy and setting over one timeline, walk-forward, with the haircut. `extraTrials` adds
// the trials of the run's other groups to the count the haircut allows for.
export function runGroup(
  market: string,
  interval: string,
  policies: readonly Policy[],
  tl: Timeline,
  costs: AgentCosts,
  cash: string,
  holdTicker: string,
  minutes: number,
  { extraTrials = 0 }: { extraTrials?: number } = {},
): GroupResult | null {
  const n = tl.times.length;
  const trainEnd = Math.floor(n * AGENT_TRAIN_SHARE);
  if (n < 200 || n - trainEnd < AGENT_FOLDS * 30) return null;
  const hold = holdReplay(holdTicker, tl, costs);
  const holdR = barReturns(hold.values);
  const trials: Trial[] = [];
  for (const policy of policies) {
    if (policy.tickers.some((t) => !tl.close[t]?.some((c) => c > 0))) continue;
    for (const param of policy.grid) {
      const run = replay(policy, param, tl, costs, cash, minutes);
      trials.push({ policy, param, run, r: barReturns(run.values) });
    }
  }
  // The haircut: how much the trials' Sharpe ratios over holding vary, and how many there were.
  const perBar = trials.map((t) => {
    const ex = t.r.map((x, i) => x - holdR[i]).slice(1);
    const s = sd(ex);
    return s > 0 ? mean(ex) / s : 0;
  });
  const sr0 = expectedMaxSharpe(trials.length + extraTrials, sd(perBar) ** 2);
  const foldSize = Math.floor((n - trainEnd) / AGENT_FOLDS);
  const folds = Array.from({ length: AGENT_FOLDS }, (_, f) => [
    trainEnd + f * foldSize,
    f === AGENT_FOLDS - 1 ? n - 1 : trainEnd + (f + 1) * foldSize - 1,
  ]);
  const sharpeOver = (r: readonly number[], i0: number, i1: number) => {
    const xs = r.slice(i0, i1 + 1);
    const s = sd(xs);
    return s > 0 ? mean(xs) / s : -Infinity;
  };
  const holdMetrics = metricsOf(tl.times, holdR, trainEnd, n - 1, [], mean(hold.values));
  const results: StrategyResult[] = [];
  for (const policy of policies) {
    const mine = trials.filter((t) => t.policy.key === policy.key);
    if (mine.length === 0) continue;
    const walk = new Array<number>(n).fill(0);
    const chosen: number[] = [];
    const walkTrades: AgentTrade[] = [];
    let valueSum = 0;
    for (const [i0, i1] of folds) {
      const pick = mine.reduce((best, t) =>
        sharpeOver(t.r, 1, i0 - 1) > sharpeOver(best.r, 1, i0 - 1) ? t : best,
      );
      chosen.push(pick.param);
      for (let i = i0; i <= i1; i += 1) {
        walk[i] = pick.r[i];
        valueSum += pick.run.values[i] / pick.run.values[i0 - 1];
      }
      walkTrades.push(
        ...pick.run.trades
          .filter((t) => t.at >= tl.times[i0] && t.at <= tl.times[i1])
          .map((t) => ({
            ...t,
            amountCents: t.amountCents / pick.run.values[i0 - 1],
            feeCents: t.feeCents / pick.run.values[i0 - 1],
            spreadCents: t.spreadCents / pick.run.values[i0 - 1],
          })),
      );
    }
    // Trades are scaled to each fold's start so turnover reads against an index from 1.
    const w = metricsOf(tl.times, walk, trainEnd, n - 1, walkTrades, valueSum / (n - trainEnd));
    w.costsCents = Math.round(w.costsCents * START_CENTS);
    const ex = walk.slice(trainEnd).map((x, k) => x - holdR[trainEnd + k]);
    const dsr = probabilisticSharpe(ex, sr0);
    const verdict: Verdict =
      w.cagr < 0
        ? "loses_money"
        : dsr >= AGENT_MIN_DSR && w.cagr > holdMetrics.cagr
          ? "beats_hold"
          : "behind_hold";
    results.push({
      key: policy.key,
      label: policy.label,
      chosen,
      walk: w,
      hold: holdMetrics,
      excessCagr: w.cagr - holdMetrics.cagr,
      dsr,
      verdict,
    });
  }
  return {
    market,
    interval,
    from: tl.times[trainEnd],
    to: tl.times[n - 1],
    bars: n - trainEnd,
    trials: trials.length + extraTrials,
    results: results.sort((a, b) => b.walk.sharpe - a.walk.sharpe),
    hold: holdMetrics,
  };
}
