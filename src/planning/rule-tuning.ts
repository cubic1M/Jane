import {
  RULE_TUNE_DROP_SLACK_POINTS,
  RULE_TUNE_MIN_GAIN,
  TRADING_DAYS_PER_YEAR,
} from "@/config/backtest";
import type { ReplayResult } from "./rule-replay";

// How a tuning experiment is judged (docs/backtests/log.md). Pure.

export type Scored = {
  // Time-weighted, a year.
  yearly: number;
  worstDrop: number;
  // The yearly return for each point of worst drop: return for the risk taken.
  objective: number;
  trades: number;
  costCents: number;
};

export function scoreOf(
  r: Pick<ReplayResult, "totalReturn" | "worstDrop" | "index" | "trades" | "costCents">,
): Scored {
  const years = Math.max(1, r.index.length - 1) / TRADING_DAYS_PER_YEAR;
  const yearly = (1 + r.totalReturn) ** (1 / years) - 1;
  const drop = r.worstDrop.fraction;
  return {
    yearly,
    worstDrop: drop,
    objective: yearly / Math.max(Math.abs(drop), 0.01),
    trades: r.trades.length,
    costCents: r.costCents,
  };
}

export type Window = { candidate: Scored; current: Scored; plain: Scored };

// Whether a window's candidate beats the current settings (and, if asked, plain rebalancing) on
// the objective, with its worst drop inside the level's tolerance.
export function wins(w: Window, againstPlain: boolean): { ok: boolean; why: string } {
  const tolerance = w.plain.worstDrop - RULE_TUNE_DROP_SLACK_POINTS / 100;
  if (w.candidate.worstDrop < tolerance) return { ok: false, why: "worst drop past tolerance" };
  if (
    w.candidate.objective < w.current.objective * (1 + RULE_TUNE_MIN_GAIN) &&
    w.current.objective > 0
  )
    return { ok: false, why: "not better than the current settings" };
  if (againstPlain && w.candidate.objective <= w.plain.objective)
    return { ok: false, why: "not better than plain rebalancing" };
  return { ok: true, why: "better" };
}

// Kept only when it wins in training and on the held-out years.
export function keep(train: Window, validate: Window): { kept: boolean; why: string } {
  const t = wins(train, false);
  if (!t.ok) return { kept: false, why: `training: ${t.why}` };
  const v = wins(validate, true);
  if (!v.ok) return { kept: false, why: `held-out: ${v.why}` };
  return { kept: true, why: "better in training and on the held-out years" };
}
