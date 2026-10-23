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

// The rule replay ("Did the extra rules help?", src/planning/rule-replay.ts): the autopilot and
// the daily scan's own rules run day by day over the same history, against plain rebalancing and
// buy and hold. Each starts with BACKTEST_START_CENTS and gets the practice portfolio's monthly
// money (PRACTICE_MONTHLY_ADD_CENTS) on this day of the month, as the live autopilot does.
export const RULE_REPLAY_ADD_DAY = 1;
// Each trade's cost, in basis points of what changes hands: half the bid-ask spread of a liquid
// ETF or large company, roughly. The model ETFs trade commission-free; the spread is still paid.
// Taken off the value as it is paid. FOR REVIEW.
export const RULE_REPLAY_TRADE_COST_BPS = 2;
// A rule made results worse at a level when, with it, the time-weighted return over the whole
// replay was lower, or the worst drop deeper, than without it by more than this many percentage
// points. Smaller differences are noise from trade timing.
export const RULE_REPLAY_WORSE_POINTS = 0.25;
// The two stress periods each replay reports: its worst fall inside each.
export const RULE_REPLAY_STRESS: readonly { label: string; from: string; to: string }[] = [
  { label: "2020", from: "2020-01-01", to: "2020-12-31" },
  { label: "2022", from: "2022-01-01", to: "2022-12-31" },
];
export const RULE_REPLAY_NOTE =
  "A replay of the autopilot's own rules over past prices, not a forecast: future results will be different. Returns are time-weighted (the monthly money doesn't count as gain) and before taxes, so a harvested loss shows only its trading cost here.";
// What each replay is called on the page and in the chat.
export const RULE_REPLAY_STRATEGY_LABELS = {
  rules: "Autopilot with the extra rules",
  rebalance: "Plain rebalancing",
  hold: "Buy and hold",
} as const;
// On the sample market the swap funds' made-up prices wander away from the main funds' (on
// real prices they track each other closely), so the sample can't judge tax-loss swaps.
export const RULE_REPLAY_SAMPLE_NOTE =
  "Made-up prices: the sample's swap funds drift away from the main funds, so tax-loss swaps look worse here than they would on real prices.";

// Tuning the rules (docs/backtests/log.md): every change to a rule's numbers is chosen on the
// training years and kept only if it also wins on the later, held-out years (walk-forward), each
// replayed from a fresh start with the same money in.
export const RULE_TUNE_TRAIN = { from: "2016-01-04", to: "2021-12-31" } as const;
export const RULE_TUNE_VALIDATE = { from: "2022-01-03", to: null } as const;
// A level's objective: the yearly time-weighted return for each point of its worst drop, with
// the worst drop no deeper than plain rebalancing's at the same level plus this many points.
export const RULE_TUNE_DROP_SLACK_POINTS = 2;
// A change is kept only when its objective beats the current settings' by at least this share,
// in training and on the held-out years, and beats plain rebalancing's on the held-out years.
export const RULE_TUNE_MIN_GAIN = 0.01;
