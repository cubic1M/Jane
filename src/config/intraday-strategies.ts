import type { RiskLevel } from "@/config/investing";

// Day trading for the practice portfolio (Phase AW, Stage A, demo advice only, Very high only):
// public, well-known intraday rules, long only (the practice ledger never shorts), on 5-minute
// bars of the S&P 500 fund. Two families: ICT-style price action (an opening-range break, a sweep
// of the prior day's low, a fair value gap, in the morning killzone) and order-flow proxies that
// need only bars (VWAP reversion, a volume imbalance). Generic versions of the public concepts;
// nothing from any course. Each is replayed walk-forward after slippage
// (src/planning/intraday.ts) and shown with its honest result against holding the fund. FOR
// REVIEW: every number here.

export type IntradayRuleId =
  "opening_range" | "liquidity_sweep" | "fair_value_gap" | "vwap_reversion" | "volume_imbalance";

export type IntradayRule = {
  label: string;
  line: string;
  how: string;
  family: "price_action" | "order_flow";
  // The small grid its one setting is chosen from, on the earlier years.
  grid: readonly number[];
  param: string;
};

export const INTRADAY_RULES: Readonly<Record<IntradayRuleId, IntradayRule>> = {
  opening_range: {
    label: "Opening-range break",
    line: "Buy when the price breaks above its first minutes' high; out at the range's low, a target or the close.",
    how: "The high and low of the first N minutes; the first 5-minute close above the high buys, with the stop at the range's low and a target twice the risk; out by the close.",
    family: "price_action",
    grid: [15, 30],
    param: "minutes in the range",
  },
  liquidity_sweep: {
    label: "Liquidity sweep",
    line: "When the price dips under yesterday's low and snaps back in the morning, buy the snap-back.",
    how: "In the morning killzone (9:30 to 11:00 New York time), a 5-minute bar that trades below the prior day's low and closes back above it buys at its close, with the stop under that bar's low and a target R times the risk; out by the close.",
    family: "price_action",
    grid: [1.5, 2],
    param: "target, in multiples of the risk",
  },
  fair_value_gap: {
    label: "Fair value gap",
    line: "After a sharp move up leaves a gap between bars, buy when the price comes back into it.",
    how: "In the killzone, three bars where the third's low is above the first's high by at least the gap size; the first later bar that dips into the gap and closes above its bottom buys, stop at the first bar's low, target twice the risk; out by the close.",
    family: "price_action",
    grid: [0.0005, 0.001],
    param: "smallest gap, as a share of the price",
  },
  vwap_reversion: {
    label: "VWAP reversion",
    line: "When the price falls well below the day's average traded price, buy for the bounce back to it.",
    how: "Before 2 p.m., a close at least D below the session's volume-weighted average price buys; out at that average, at a stop twice D below the buy, or at the close.",
    family: "order_flow",
    grid: [0.003, 0.006],
    param: "distance below VWAP, as a share",
  },
  volume_imbalance: {
    label: "Volume imbalance",
    line: "A burst of buying (a strong close on unusual volume) in the morning: buy the next bar.",
    how: "In the killzone, an up bar closing in the top fifth of its range on at least M times the last hour's average volume buys the next bar's open, stop at its low, target twice the risk; out by the close. A proxy for order flow from bars alone: trade-by-trade volume delta isn't used.",
    family: "order_flow",
    grid: [2, 3],
    param: "times the average volume",
  },
};

export const INTRADAY_RULE_IDS = Object.keys(INTRADAY_RULES) as IntradayRuleId[];

// The fund traded, and the bars.
export const INTRADAY_TICKER = "SPY";
export const INTRADAY_TIMEFRAME = "5Min";
// New York session minutes: the open, the killzone's end, the last entry for VWAP reversion.
export const SESSION_OPEN_MINUTE = 9 * 60 + 30;
export const SESSION_CLOSE_MINUTE = 16 * 60;
export const KILLZONE_END_MINUTE = 11 * 60;
export const VWAP_LAST_ENTRY_MINUTE = 14 * 60;
// What a trade costs each way, as a share: slippage and the spread (commissions are zero).
export const INTRADAY_SLIPPAGE = 0.0003;
// Chosen on the years to the end of this one, scored on the years after.
export const INTRADAY_TRAIN_END = "2023-12-31";
// The sleeve: the most of the practice portfolio, by level. Very high only.
export const INTRADAY_SLEEVE_BY_LEVEL: Readonly<Partial<Record<RiskLevel, number>>> = { 5: 0.05 };
export const INTRADAY_WARNING =
  "Most people who day trade lose money, and the costs alone eat most small edges. This is practice money, to see how a rule would have done, not a way to earn.";
