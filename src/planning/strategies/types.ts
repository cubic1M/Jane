import type { RiskLevel } from "@/config/investing";
import type { StrategyAssetId } from "@/config/portfolios";
import type { StrategyId } from "@/config/strategies";

// The strategy library's shapes (Phase AW, Stage A). A strategy is a pure function from what is
// known on a day (the closes before it, the level's limits, the portfolio's own value and high)
// to target weights over the strategy universe (STRATEGY_ASSETS). Practice money only.

export type Weights = Partial<Record<StrategyAssetId, number>>;

export type LevelLimits = {
  level: RiskLevel;
  // The level's mix (the static strategy), on the universe's four model funds.
  base: Weights;
  // The most in stocks: the level's mix's share. No strategy takes more risk than its level.
  stocksShare: number;
  maxDrawdown: number;
  volCap: number;
  maxAsset: number;
  maxReal: number;
};

export type StrategyContext = {
  date: string;
  // Aligned daily closes for every asset, oldest first. Only indexes below `t` are known.
  closes: Readonly<Record<StrategyAssetId, readonly number[]>>;
  t: number;
  limits: LevelLimits;
  // The strategy's own portfolio so far (for a drawdown floor).
  portfolio: { value: number; peak: number };
};

export type Params = Readonly<Record<string, number | string>>;

export type Strategy = {
  id: StrategyId;
  weights: (ctx: StrategyContext, params: Params) => Weights;
};

// One strategy with one set of its parameters.
export type Candidate = { id: StrategyId; params: Params };
