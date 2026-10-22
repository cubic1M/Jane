import type { PracticeClass } from "@/config/portfolios";
import type { RiskLevel } from "@/config/investing";

// More kinds of opportunity for the practice portfolio's daily scan (Phase AW, Stage A, after
// step 292). Practice money and the sample market only: every number here is demo advice,
// FOR REVIEW before Stage B. The rules are in src/planning/practice-opportunities.ts; nothing
// there has a number of its own. The step 292 kinds and their tuned values stay in
// ./practice-scan.ts, which spreads these in.

export type OpportunityKind =
  | "new_money_rebalance"
  | "cash_drag"
  | "cheaper_fund"
  | "payday_timing"
  | "drift_warning"
  | "glide_path"
  | "risk_mismatch"
  | "max_drop_near";

export const OPPORTUNITY_KINDS: readonly OpportunityKind[] = [
  "new_money_rebalance",
  "cash_drag",
  "cheaper_fund",
  "payday_timing",
  "drift_warning",
  "glide_path",
  "risk_mismatch",
  "max_drop_near",
];

export const OPPORTUNITY_LABELS: Readonly<Record<OpportunityKind, string>> = {
  new_money_rebalance: "Rebalance with new money, not a sale",
  cash_drag: "Put idle cash to work",
  cheaper_fund: "Switch to a cheaper twin fund",
  payday_timing: "Invest right after payday",
  drift_warning: "Drift is close to the band",
  glide_path: "Step down as your goal gets close",
  risk_mismatch: "More risk than you said",
  max_drop_near: "Close to the drop you said you could take",
};

// Same shape as SCAN_CAPS. sizeShare and positionShare matter only for kinds with trades;
// the advice-only kinds (no trades: they suggest or open settings) have 0 there. perMonth is
// how many of a kind may be flagged in a calendar month.
export const OPPORTUNITY_CAPS: Readonly<
  Record<OpportunityKind, { sizeShare: number; positionShare: number; perMonth: number }>
> = {
  new_money_rebalance: { sizeShare: 0.2, positionShare: 0.8, perMonth: 4 },
  cash_drag: { sizeShare: 0.2, positionShare: 0.8, perMonth: 2 },
  cheaper_fund: { sizeShare: 0.5, positionShare: 0.8, perMonth: 2 },
  payday_timing: { sizeShare: 0, positionShare: 0, perMonth: 1 },
  drift_warning: { sizeShare: 0, positionShare: 0, perMonth: 2 },
  glide_path: { sizeShare: 0, positionShare: 0, perMonth: 1 },
  risk_mismatch: { sizeShare: 0, positionShare: 0, perMonth: 1 },
  max_drop_near: { sizeShare: 0, positionShare: 0, perMonth: 1 },
};

export const OPPORTUNITY_CONFIDENCE: Readonly<
  Record<OpportunityKind, { percent: number; reason: string }>
> = {
  new_money_rebalance: {
    percent: 88,
    reason:
      "A fixed rule: the cash was going in anyway, and putting it where the mix is short avoids selling.",
  },
  cash_drag: {
    percent: 80,
    reason:
      "The cash has sat for days; what investing it earns depends on markets, so only the plan's own mix is bought.",
  },
  cheaper_fund: {
    percent: 82,
    reason:
      "Both funds hold the same kind of investment; the yearly cost is the only difference, and it's small.",
  },
  payday_timing: {
    percent: 65,
    reason:
      "Your paycheck dates come from your deposits; investing just after payday is a habit, not a market call.",
  },
  drift_warning: {
    percent: 85,
    reason: "A fixed measure of how far the mix is from your level's targets today.",
  },
  glide_path: {
    percent: 75,
    reason:
      "The usual rule takes less risk as the money's date gets close; your goal date is what you told Jane.",
  },
  risk_mismatch: {
    percent: 70,
    reason:
      "It compares your mix with past crashes, which won't repeat exactly, against the drop you said you could take.",
  },
  max_drop_near: {
    percent: 72,
    reason:
      "Your own limit, not a market call: the portfolio is already most of the way to the drop you said you could take.",
  },
};

// Kinds that keep the person inside what they said they could take. Their rank never falls
// below SAFETY_HISTORY_FLOOR however often they're declined (src/config/suggestions.ts reads it).
export const SAFETY_KINDS: readonly OpportunityKind[] = [
  "drift_warning",
  "glide_path",
  "risk_mismatch",
  "max_drop_near",
];

// Rebalance with new money: fires when the mix is past the band or within DRIFT_WARNING_SHARE
// of it and cash is waiting; the cash buys what is under target instead of the autopilot
// selling what is over.

// A drift warning: the furthest-off kind (or stocks together) at least this share of the way
// to its band, but not past it.
export const DRIFT_WARNING_SHARE = 0.8;

// Idle cash: cash waiting above the buffer of at least this much, and this share of the
// portfolio, with no buy for this many days. It earns nothing in the ledger, so what it misses
// is shown at the short-term bill yield (BIL's 30-day SEC yield, about 4%, October 2026; FOR
// REVIEW), never a stock-market return.
export const CASH_DRAG_MIN_CENTS = 20_000;
export const CASH_DRAG_MIN_SHARE = 0.02;
export const CASH_DRAG_MIN_DAYS = 5;
export const CASH_DRAG_RATE = 0.04;
export const CASH_DRAG_RATE_SOURCE = "SPDR BIL 30-day SEC yield, October 2026; FOR REVIEW";

// What each practice fund costs a year, in basis points (the expense ratio), from the fund
// pages as of October 2026, FOR REVIEW. A twin fund (HARVEST_PARTNERS) at least
// CHEAPER_FUND_MIN_BPS cheaper is worth switching to.
export const PRACTICE_FUND_FEE_BPS: Readonly<Record<string, number>> = {
  VTI: 3,
  ITOT: 3,
  VXUS: 5,
  IXUS: 7,
  BND: 3,
  AGG: 3,
  BIL: 13.59,
};
export const PRACTICE_FUND_FEE_SOURCE =
  "Fund pages: Vanguard VTI, VXUS, BND; iShares ITOT, IXUS, AGG; SPDR BIL (October 2026); FOR REVIEW";
export const CHEAPER_FUND_MIN_BPS = 2;

// Payday timing: the monthly practice money lands this many days after the person's main
// payday, never later in the month than PAYDAY_ADD_MAX_DAY (so every month has the day), and
// only suggested when the day now is at least PAYDAY_TIMING_MIN_GAP_DAYS away from it.
export const PAYDAY_ADD_OFFSET_DAYS = 1;
export const PAYDAY_ADD_MAX_DAY = 28;
export const PAYDAY_TIMING_MIN_GAP_DAYS = 4;

// The glide path: the highest level for the years left until the goal date. The usual
// target-date ladder (more bonds as the date gets close), FOR REVIEW. The step is one level at
// a time.
export const GLIDE_PATH: readonly { minYears: number; maxLevel: RiskLevel }[] = [
  { minYears: 15, maxLevel: 5 },
  { minYears: 10, maxLevel: 4 },
  { minYears: 5, maxLevel: 3 },
  { minYears: 2, maxLevel: 2 },
  { minYears: 0, maxLevel: 1 },
];

// How far each kind fell in a bad crash, as a share: the 2007-09 crisis, peak to trough
// (US stocks about 51%, international stocks about 58%; US bonds about 4% at their worst in
// late 2008; Treasury bills not at all). Used to say how far a mix could fall, not when.
// FOR REVIEW. Opportunity stocks count as US stocks.
export const STRESS_DROP: Readonly<Record<PracticeClass, number>> = {
  us_stocks: 0.51,
  intl_stocks: 0.58,
  bonds: 0.04,
  cash: 0,
};
export const STRESS_DROP_SOURCE =
  "Peak to trough, October 2007 to March 2009: US total market, MSCI ex-US, US aggregate bonds; FOR REVIEW";
// The mix may sit this far over the stated drop before it counts as more risk than said.
export const RISK_MISMATCH_TOLERANCE = 0.02;

// The drop someone said they could take, when they haven't set one in their practice
// settings: from the investor profile's "If your investments fell 20% in a month" answer
// (src/config/investing.ts DROP_REACTIONS). FOR REVIEW.
export const MAX_DROP_FROM_REACTION: Readonly<Record<string, number>> = {
  sell: 0.15,
  worry: 0.25,
  fine: 0.35,
  buy: 0.5,
};

// Close to the stated drop: the portfolio as held, at least this share of the way from its
// highest value of the last MAX_DROP_LOOKBACK_DAYS trading days to the stated drop. Then Jane
// suggests one level safer, once a month at most. Never a call on where markets go next.
export const MAX_DROP_NEAR_SHARE = 0.75;
export const MAX_DROP_LOOKBACK_DAYS = 60;

// Constant search: besides the daily cron, a cheap scan runs when the person opens the chat
// or the investing pages, at most once in this many minutes. It reads the ledger and the
// market data only (no Claude, no paydays), records what only suggests, and leaves every
// trade to the daily run unless the person is in suggest-only mode.
export const ON_OPEN_SCAN_MINUTES = 60;

// What the scan assumes before the person sets their own (src/planning/practice-opportunities.ts
// ScanPreferences; the settings themselves are session B1's PracticePreferences).
export const DEFAULT_CASH_BUFFER_CENTS = 0;
