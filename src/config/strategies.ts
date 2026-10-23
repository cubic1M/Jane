import type { RiskLevel } from "@/config/investing";

// The strategy library (src/planning/strategies/): ways a level's practice portfolio could be
// run beyond the fixed mix, each replayed over real history and kept only where it does better
// for the risk taken on later years than it was chosen on (docs/backtests/strategies.md).
// Practice money and demo advice only; every number here is FOR REVIEW before Stage B.

// Each level's risk budget: the deepest fall from a high and the yearly volatility of daily
// returns a strategy may show and still be chosen for the level.
export const RISK_BUDGETS: Readonly<Record<RiskLevel, { maxDrawdown: number; volCap: number }>> = {
  1: { maxDrawdown: 0.08, volCap: 0.05 },
  2: { maxDrawdown: 0.15, volCap: 0.08 },
  3: { maxDrawdown: 0.22, volCap: 0.11 },
  4: { maxDrawdown: 0.3, volCap: 0.14 },
  5: { maxDrawdown: 0.4, volCap: 0.18 },
};

// Never more of one fund than this share (the bills fund excepted: stepping aside is cash), and
// never more gold than this share. A strategy never holds more stocks than its level's mix.
export const STRATEGY_MAX_ASSET = 0.6;
export const STRATEGY_MAX_REAL = 0.15;

// Each trade's cost, in basis points of what changes hands (half the spread of a liquid ETF).
// Fund costs are already inside the adjusted closes, so they aren't taken out again.
export const STRATEGY_TRADE_COST_BPS = 2;

// The trading days in a month and a year, for look-back windows.
export const DAYS_PER_MONTH = 21;
export const DAYS_PER_YEAR = 252;

// The small, fixed parameter grid of each strategy: no wide search.
export const STRATEGY_GRID = {
  // The level's mix, rebalanced on a band (5 points, today's autopilot) or on the calendar.
  static: { rebalance: ["band", "monthly", "quarterly", "annual"] },
  // Each sleeve (or everything, stocks capped at the level's share) split in inverse proportion
  // to each fund's volatility over the window.
  inverse_vol: { windowDays: [63, 126], scope: ["sleeves", "all"] },
  // The level's mix with stocks scaled down when the stocks' volatility over the window would
  // take the portfolio past the level's volatility cap; the rest in bills.
  vol_target: { windowDays: [21, 63] },
  // The level's mix, each risky fund held only while its close is above its moving average over
  // this many months; otherwise in bills.
  trend: { months: [6, 10] },
  // The stock sleeve in the stock fund with the best return over the look-back (relative), and in
  // intermediate Treasuries when even that return is below bills' (absolute).
  dual_momentum: { lookbackDays: [126, 252] },
  // The least-volatile long-only mix over the window, with the level's stock share.
  min_variance: { windowDays: [126, 252] },
  // A floor below the high, the level's maximum drawdown down; stocks are this multiple of the
  // cushion above the floor, at most the level's share.
  cppi: { multiplier: [3, 5] },
} as const;
export type StrategyId = keyof typeof STRATEGY_GRID;

// What each strategy is called on the page and in the chat.
export const STRATEGY_LABELS: Readonly<Record<StrategyId, string>> = {
  static: "The level's mix",
  inverse_vol: "Inverse volatility",
  vol_target: "Volatility target",
  trend: "Trend filter",
  dual_momentum: "Dual momentum",
  min_variance: "Minimum variance",
  cppi: "Drawdown floor (CPPI)",
};

// Choosing a level's strategy (src/planning/strategies/select.ts): chosen on the years up to
// STRATEGY_TRAIN_END, scored on the years after (walk-forward), from each of these start years.
// It is kept only if, on the later years, it stays inside the level's budget and its Sortino
// ratio beats the level's mix (rebalanced on the band) by this share; otherwise the mix stays.
export const STRATEGY_TRAIN_END = "2021-12-31";
export const STRATEGY_START_YEARS: readonly number[] = [2016, 2017, 2018];
export const STRATEGY_MIN_SORTINO_GAIN = 0.1;

export const STRATEGY_NOT_A_FORECAST =
  "A replay of the past, not a forecast: future results will be different.";

// The weekly evaluation (src/lib/investments/strategy-eval.ts) runs only on at least this many
// shared trading days of stored history (about three years: a training span and later years).
export const STRATEGY_EVAL_MIN_DAYS = 756;

// The practice autopilot reads this many calendar days of stored closes to work out a level's
// strategy for the month: the longest look-back (a year) with room for holidays.
export const STRATEGY_FOLLOW_HISTORY_DAYS = 550;
