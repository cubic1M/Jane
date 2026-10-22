import { DRIFT_POINTS } from "@/config/investing";
import type { PracticeClass } from "@/config/portfolios";

// Backtests by risk level (spec step 295, Phase AW, Stage A): how each level's model portfolio
// would have behaved over past prices. A replay of history, never a forecast. Demo advice only.
// FOR REVIEW with counsel and an adviser before Stage B.

// The sample amount every replay starts with, the same for every level so they compare.
export const BACKTEST_START_CENTS = 1_000_000;

// Each fund's yearly cost (expense ratio) in basis points, taken out a little each trading day.
// From the fund pages (Vanguard VTI 0.03%, VXUS 0.05%, BND 0.03%; SPDR BIL 0.1359%), as of
// October 2026. FOR REVIEW.
export const BACKTEST_FEE_BPS: Readonly<Record<PracticeClass, number>> = {
  us_stocks: 3,
  intl_stocks: 5,
  bonds: 3,
  cash: 13.59,
};
export const BACKTEST_FEE_SOURCE =
  "Fund pages: Vanguard VTI, VXUS and BND; SPDR BIL (October 2026); FOR REVIEW";

// Rebalancing: back to the targets on any day a class drifts more than this many percentage
// points from its target. The same band as the portfolio review's off-target check.
export const BACKTEST_REBALANCE_BAND_POINTS = DRIFT_POINTS;

// Trading costs per rebalance: none (the model ETFs trade commission-free), said so.
export const BACKTEST_TRADE_COST_BPS = 0;

// Stored real history is used only when it covers at least this many trading days that every
// model fund shares (about a year); a shorter load replays the sample market instead.
export const BACKTEST_MIN_REAL_DAYS = 252;

// Trading days in a year, for spreading the yearly fund cost over the days.
export const TRADING_DAYS_PER_YEAR = 252;

// A calendar year counts as a whole year (for the best and worst year) when the replay has its
// first trading day within this many days of January 1 and its last within this many of
// December 31. A part year is shown, marked "so far" or "from", but never ranked.
export const FULL_YEAR_SLACK_DAYS = 7;

// The words beside every replay. Never "forecast", "projection" or "expected".
export const BACKTEST_NOT_A_FORECAST =
  "A replay of the past, not a forecast: future results will be different.";
export const SAMPLE_HISTORY_NOTE =
  "The sample market's made-up prices, with a planted crash and recovery; not real prices.";
export const REAL_HISTORY_NOTE =
  "Daily closes from the market data, adjusted for splits and dividends.";
