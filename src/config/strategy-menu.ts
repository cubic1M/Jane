// The strategy menu (Phase AW, Stage A): more ways to run the practice portfolio than the
// research pick for its level (src/config/strategies.ts, still the default). Each is a public,
// well-known idea, replayed on real closes with its costs (src/planning/strategy-menu.ts) and
// shown with its honest result, the levels whose risk budget it fits (RISK_BUDGETS) and how it
// did against the level's own mix. Practice money and demo advice only; a replay of the past,
// never a forecast. FOR REVIEW: the funds and every parameter here.

export type MenuStrategyId =
  | "value_tilt"
  | "momentum_tilt"
  | "quality_tilt"
  | "dividend_growth"
  | "equal_weight"
  | "sector_rotation"
  | "all_weather";

export type MenuStrategy = {
  label: string;
  // What it is, in a line, for the card.
  line: string;
  // How it decides, for "how does it work".
  how: string;
  // "tilt": the level's US stocks share held in `fund` instead of the whole market (VTI).
  // "sector_rotation": that share in the top SECTOR_ROTATION_TOP sector funds by their last
  // SECTOR_LOOKBACK_DAYS of return, chosen each month. "all_weather": the ALL_WEATHER_FUNDS,
  // each weighted by the inverse of its volatility over ALL_WEATHER_WINDOW_DAYS (risk parity),
  // the same at every level.
  rule: "tilt" | "sector_rotation" | "all_weather";
  fund?: string;
};

export const MENU_STRATEGIES: Readonly<Record<MenuStrategyId, MenuStrategy>> = {
  value_tilt: {
    label: "Value tilt",
    line: "US stocks in cheaper, slower-growing companies, which have paid off over long stretches.",
    how: "The level's US stocks share is held in a value fund (VTV) instead of the whole market.",
    rule: "tilt",
    fund: "VTV",
  },
  momentum_tilt: {
    label: "Momentum tilt",
    line: "US stocks that have risen most lately, which have tended to keep rising for a while.",
    how: "The level's US stocks share is held in a momentum fund (MTUM), which re-picks its companies twice a year.",
    rule: "tilt",
    fund: "MTUM",
  },
  quality_tilt: {
    label: "Quality tilt",
    line: "US companies with steady profits and little debt, which have fallen less in bad years.",
    how: "The level's US stocks share is held in a quality fund (QUAL).",
    rule: "tilt",
    fund: "QUAL",
  },
  dividend_growth: {
    label: "Dividend growth",
    line: "US companies that have raised their dividend every year for a decade or more.",
    how: "The level's US stocks share is held in a dividend-growth fund (VIG).",
    rule: "tilt",
    fund: "VIG",
  },
  equal_weight: {
    label: "Equal weight",
    line: "The S&P 500 with every company the same size, so the biggest few don't dominate.",
    how: "The level's US stocks share is held in an equal-weight S&P 500 fund (RSP).",
    rule: "tilt",
    fund: "RSP",
  },
  sector_rotation: {
    label: "Sector rotation",
    line: "Each month, the three US sectors that rose most over the last six months.",
    how: "The level's US stocks share is split equally among the 3 of 9 sector funds with the best return over the last 126 trading days, chosen again each month.",
    rule: "sector_rotation",
  },
  all_weather: {
    label: "All-weather (risk parity)",
    line: "Stocks, long and medium bonds, gold and commodities, each sized so none dominates the risk.",
    how: "Each of VTI, TLT, IEF, GLD and DBC is weighted by the inverse of its last 63 trading days' volatility, rebalanced monthly; the same at every level.",
    rule: "all_weather",
  },
};

export const MENU_STRATEGY_IDS = Object.keys(MENU_STRATEGIES) as MenuStrategyId[];

// The nine sector funds (Select Sector SPDRs with history from 2016).
export const SECTOR_FUNDS: readonly string[] = [
  "XLB",
  "XLE",
  "XLF",
  "XLI",
  "XLK",
  "XLP",
  "XLU",
  "XLV",
  "XLY",
];
export const SECTOR_ROTATION_TOP = 3;
export const SECTOR_LOOKBACK_DAYS = 126;
export const ALL_WEATHER_FUNDS: readonly string[] = ["VTI", "TLT", "IEF", "GLD", "DBC"];
export const ALL_WEATHER_WINDOW_DAYS = 63;
// The level's own mix, the comparison: these funds for its four kinds.
export const MENU_MIX_FUNDS = {
  us_stocks: "VTI",
  intl_stocks: "VXUS",
  bonds: "BND",
  cash: "BIL",
} as const;
// A strategy fits a level when it is no riskier than the level's budget or its own mix (worst
// drop, volatility) by more than this, as a share. FOR REVIEW.
export const MENU_FIT_SLACK = 0.01;
// Points kept for a card's little equity curve.
export const MENU_CURVE_POINTS = 40;
