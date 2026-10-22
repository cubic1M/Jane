import { TARGET_MIXES, type RiskLevel } from "@/config/investing";

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
export const HARVEST_PARTNERS: Readonly<
  Partial<Record<PracticeClass, { ticker: string; name: string }>>
> = {
  us_stocks: { ticker: "ITOT", name: "Core S&P Total US Stock Market ETF" },
  intl_stocks: { ticker: "IXUS", name: "Core MSCI Total International Stock ETF" },
  bonds: { ticker: "AGG", name: "Core US Aggregate Bond ETF" },
};

// The model ETFs that hold one kind: the main one, then its swap partner.
export const classTickers = (c: PracticeClass): string[] =>
  [PRACTICE_ETFS[c].ticker, HARVEST_PARTNERS[c]?.ticker].filter((t): t is string => !!t);

// Which kind a model ETF holds, or null for anything else (an opportunity stock).
export function classOf(ticker: string): PracticeClass | null {
  const t = ticker.toUpperCase();
  return (
    (Object.keys(PRACTICE_ETFS) as PracticeClass[]).find((c) => classTickers(c).includes(t)) ??
    null
  );
}

export const PRACTICE_UNIVERSE: ReadonlySet<string> = new Set([
  ...(Object.keys(PRACTICE_ETFS) as PracticeClass[]).flatMap(classTickers),
  ...PRACTICE_STOCKS,
]);

// Practice money a new portfolio starts with: a stated sample amount, never linked to anything.
export const PRACTICE_START_CENTS = 1_000_000;
export const PRACTICE_MONTHLY_ADD_CENTS = 50_000;

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
  // At most this many trades a day for one portfolio.
  tradesPerDay: 12,
} as const;
