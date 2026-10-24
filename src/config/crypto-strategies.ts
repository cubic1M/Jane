import type { RiskLevel } from "@/config/investing";

// Crypto for the practice portfolio (Phase AW, Stage A, demo advice only): bitcoin and ether as
// a small sleeve beside the plan, at Very high only, run by a trend or momentum rule or simply
// held. Each is replayed on real daily closes after costs (src/planning/crypto-strategies.ts),
// its parameters chosen on the earlier years and scored on the later ones, against holding.
// Crypto has fallen 70% to 80% more than once; the sleeve is capped for that. FOR REVIEW: every
// number here.

export type CryptoStrategyId = "crypto_hold" | "crypto_trend" | "crypto_momentum";

export const CRYPTO_ASSETS = ["BTC", "ETH"] as const;
export type CryptoAsset = (typeof CRYPTO_ASSETS)[number];
export const CRYPTO_NAMES: Readonly<Record<CryptoAsset, string>> = { BTC: "bitcoin", ETH: "ether" };

export const CRYPTO_STRATEGIES: Readonly<
  Record<
    CryptoStrategyId,
    { label: string; line: string; how: string; grid: readonly number[]; param: string }
  >
> = {
  crypto_hold: {
    label: "Crypto, held",
    line: "Half bitcoin, half ether, held through everything.",
    how: "Bought once and rebalanced to half and half each month.",
    grid: [0],
    param: "none",
  },
  crypto_trend: {
    label: "Crypto trend",
    line: "Each coin held only while its price is above its moving average; otherwise cash.",
    how: "Checked each Monday: a coin above its average over the last N days is held, half the sleeve each; below it, that half waits in cash.",
    grid: [50, 100, 200],
    param: "days in the average",
  },
  crypto_momentum: {
    label: "Crypto momentum",
    line: "The coin that rose more over the last weeks, while it's rising; otherwise cash.",
    how: "Checked each Monday: the whole sleeve in whichever of bitcoin and ether gained more over the last N days, if it gained at all; otherwise cash.",
    grid: [30, 60, 90],
    param: "days of look-back",
  },
};

export const CRYPTO_STRATEGY_IDS = Object.keys(CRYPTO_STRATEGIES) as CryptoStrategyId[];

// What a trade costs: fees and the spread, and slippage, each a share of what changes hands.
export const CRYPTO_FEE = 0.0025;
export const CRYPTO_SLIPPAGE = 0.001;
// Chosen on the years to the end of this one, scored on the years after.
export const CRYPTO_TRAIN_END = "2021-12-31";
// The sleeve: the most of the practice portfolio, by level. Very high only.
export const CRYPTO_SLEEVE_BY_LEVEL: Readonly<Partial<Record<RiskLevel, number>>> = { 5: 0.05 };
// In the practice portfolio: a coin's trade smaller than this waits (no dust trades).
export const CRYPTO_SLEEVE_MIN_TRADE_CENTS = 2_500;
// How many calendar days of closes the live sleeve reads before it decides: the longest
// look-back in the grids (200 days) with room for weekends in a feed of trading days.
export const CRYPTO_SLEEVE_HISTORY_DAYS = 330;
export const CRYPTO_WARNING =
  "Crypto has lost 70% to 80% of its value more than once, and can again. Practice money only.";
