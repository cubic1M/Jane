import { TARGET_MIXES, type RiskLevel } from "@/config/investing";
import { THEMES } from "@/config/themes";

// The practice portfolios (spec step 288, Phase AW, Stage A): one model portfolio of diversified
// index ETFs for each of the five risk levels (Very low to Very high), run on practice money
// only. The stock, bond and cash targets are the investor profile's (TARGET_MIXES in
// src/config/investing.ts), so the real-account mix check and the practice portfolio always
// agree. FOR REVIEW with counsel and an adviser before Stage B.

// The index ETFs a model portfolio holds, one per kind of investment. The prices are the market
// data's (src/lib/market), sample until a real feed is connected.
export const PRACTICE_ETFS = {
  us_stocks: { ticker: "VTI", name: "Total US Stock Market ETF" },
  intl_stocks: { ticker: "VXUS", name: "Total International Stock ETF" },
  bonds: { ticker: "BND", name: "Total US Bond Market ETF" },
  cash: { ticker: "BIL", name: "1-3 Month Treasury Bill ETF" },
} as const;
export type PracticeClass = keyof typeof PRACTICE_ETFS;

export type ModelPortfolio = {
  level: RiskLevel;
  // Shares by kind, summing to 1.
  weights: Record<PracticeClass, number>;
};

export const MODEL_PORTFOLIOS: Readonly<Record<RiskLevel, ModelPortfolio>> = Object.fromEntries(
  ([1, 2, 3, 4, 5] as const).map((level) => [
    level,
    { level, weights: { ...TARGET_MIXES[level] } },
  ]),
) as Record<RiskLevel, ModelPortfolio>;

export const stocksShare = (level: RiskLevel) =>
  MODEL_PORTFOLIOS[level].weights.us_stocks + MODEL_PORTFOLIOS[level].weights.intl_stocks;

// Opportunities (small, capped positions beyond the model) only at these levels (step 292).
export const OPPORTUNITY_LEVELS: readonly RiskLevel[] = [4, 5];

// Income stability, from how the person is paid (the profile's income_pattern fact): steady pay
// leaves the horizon's capacity as it is; uneven or business income lowers it by this many
// levels, because a lean month can force a sale at a bad time.
export const STABILITY_PENALTY: Readonly<Record<"steady" | "variable", number>> = {
  steady: 0,
  variable: 1,
};
export const STABILITY_SOURCE =
  "Income that moves around raises the chance of needing the money early (FINRA suitability: financial situation and needs); FOR REVIEW";

// What a practice portfolio may hold: the model ETFs, and the large companies the sample market
// watches (for opportunities at High and Very high only, step 292). No options, no leverage, no
// shorting: the ledger refuses anything outside this list and any trade that needs borrowing.
export const PRACTICE_STOCKS = ["AAPL", "MSFT", "NVDA", "TSLA"] as const;

// For a tax-loss swap (step 292): a similar fund of the same kind, so the mix stays as it is,
// that isn't the same fund (selling at a loss and buying the same fund back within 30 days is a
// wash sale). Short-term bills are never at a loss worth harvesting, so they have none.
type Partner = { ticker: string; name: string };
export const HARVEST_PARTNERS: Readonly<Partial<Record<PracticeClass, Partner>>> = {
  us_stocks: { ticker: "ITOT", name: "Core S&P Total US Stock Market ETF" },
  intl_stocks: { ticker: "IXUS", name: "Core MSCI Total International Stock ETF" },
  bonds: { ticker: "AGG", name: "Core US Aggregate Bond ETF" },
};

const CLASS_KEYS = Object.keys(PRACTICE_ETFS) as PracticeClass[];

// The model ETFs that hold one kind: the main one, then its swap partner.
export function classTickers(c: PracticeClass): string[] {
  const partner = HARVEST_PARTNERS[c];
  return partner ? [PRACTICE_ETFS[c].ticker, partner.ticker] : [PRACTICE_ETFS[c].ticker];
}

// Which kind a model ETF holds, or null for anything else (an opportunity stock).
export function classOf(ticker: string): PracticeClass | null {
  const t = ticker.toUpperCase();
  return CLASS_KEYS.find((c) => classTickers(c).includes(t)) ?? null;
}

// The funds the news themes buy (src/config/themes.ts): a small slice beside the plan, outside
// the model's mix, as an opportunity stock is.
export const THEME_FUNDS: readonly string[] = [
  ...new Set(Object.values(THEMES).map((t) => t.ticker)),
];

export const PRACTICE_UNIVERSE: ReadonlySet<string> = new Set([
  ...CLASS_KEYS.flatMap((c) => classTickers(c)),
  ...PRACTICE_STOCKS,
  ...THEME_FUNDS,
]);

// Practice money a new portfolio starts with: a stated sample amount, never linked to anything.
export const PRACTICE_START_CENTS = 1_000_000;
export const PRACTICE_MONTHLY_ADD_CENTS = 50_000;
// A sample person's practice portfolio starts by itself at their first scan, this many days
// back, and those days are replayed (src/lib/practice/demo-start.ts), so there are trades, ideas
// and a strategy to look at from the first screen. Real people start theirs themselves.
export const DEMO_PRACTICE_REPLAY_DAYS = 42;

// Autopilot for the practice portfolio (spec step 291). Hard limits: nothing here can be turned
// up by the person or by a card; they live in code review. No leverage, no options and no
// shorting are enforced by the ledger itself (src/planning/practice-ledger.ts).
export const AUTOPILOT_LIMITS = {
  // A class this many points of the portfolio off its target is rebalanced.
  rebalanceBand: 0.05,
  // Smaller trades aren't worth making.
  minTradeCents: 1_000,
  // One trade is never more than this share of the portfolio's value.
  perTradeShare: 0.7,
  // No model ETF is ever more than this share of the portfolio (after a trade).
  perEtfShare: 0.8,
  // A single company's stock (an opportunity, step 292) is never more than this share.
  perStockShare: 0.03,
  // A news theme's fund (THEME_FUNDS) is never more than this share.
  perThemeShare: 0.06,
  // At most this many trades a day for one portfolio.
  tradesPerDay: 12,
} as const;
// The limits one portfolio runs with: the hard limits, with the rebalance band and the per-fund
// cap as the person set them (src/planning/practice-profile.ts), never above the hard ones.
export type AutopilotLimits = { readonly [K in keyof typeof AUTOPILOT_LIMITS]: number };

// The strategy universe (the strategy library, src/planning/strategies/): plain index ETFs a
// level's strategy may hold, each with its sleeve (what it counts as against the level's stock
// share) and the practice kind it sits in. The four model funds are the static mix's; the rest
// let a strategy diversify, follow trends or step aside. No leveraged, inverse or option ETFs.
// Every ticker is loaded into market_prices by the daily history job (src/lib/market/history.ts).
export type StrategySleeve = "stocks" | "bonds" | "real" | "cash";
export type StrategyAsset = {
  ticker: string;
  name: string;
  sleeve: StrategySleeve;
  // The practice kind it is held in (null: not yet held by the practice autopilot).
  practiceClass: PracticeClass | null;
};
export const STRATEGY_ASSETS = {
  us_total: {
    ticker: "VTI",
    name: "Total US Stock Market ETF",
    sleeve: "stocks",
    practiceClass: "us_stocks",
  },
  us_small_value: {
    ticker: "VBR",
    name: "Small-Cap Value ETF",
    sleeve: "stocks",
    practiceClass: "us_stocks",
  },
  intl_total: {
    ticker: "VXUS",
    name: "Total International Stock ETF",
    sleeve: "stocks",
    practiceClass: "intl_stocks",
  },
  intl_developed: {
    ticker: "VEA",
    name: "Developed Markets ETF",
    sleeve: "stocks",
    practiceClass: "intl_stocks",
  },
  emerging: {
    ticker: "VWO",
    name: "Emerging Markets ETF",
    sleeve: "stocks",
    practiceClass: "intl_stocks",
  },
  reits: { ticker: "VNQ", name: "Real Estate ETF", sleeve: "stocks", practiceClass: "us_stocks" },
  bonds_total: {
    ticker: "BND",
    name: "Total US Bond Market ETF",
    sleeve: "bonds",
    practiceClass: "bonds",
  },
  treasury_short: {
    ticker: "SHY",
    name: "1-3 Year Treasury Bond ETF",
    sleeve: "bonds",
    practiceClass: "bonds",
  },
  treasury_mid: {
    ticker: "IEF",
    name: "7-10 Year Treasury Bond ETF",
    sleeve: "bonds",
    practiceClass: "bonds",
  },
  treasury_long: {
    ticker: "TLT",
    name: "20+ Year Treasury Bond ETF",
    sleeve: "bonds",
    practiceClass: "bonds",
  },
  tips: { ticker: "TIP", name: "TIPS Bond ETF", sleeve: "bonds", practiceClass: "bonds" },
  gold: { ticker: "GLD", name: "Gold Shares", sleeve: "real", practiceClass: null },
  tbills: {
    ticker: "BIL",
    name: "1-3 Month Treasury Bill ETF",
    sleeve: "cash",
    practiceClass: "cash",
  },
} as const satisfies Record<string, StrategyAsset>;
export type StrategyAssetId = keyof typeof STRATEGY_ASSETS;
export const STRATEGY_ASSET_IDS = Object.keys(STRATEGY_ASSETS) as StrategyAssetId[];
export const strategyTickers = () => STRATEGY_ASSET_IDS.map((a) => STRATEGY_ASSETS[a].ticker);
