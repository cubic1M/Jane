import type { RiskLevel } from "@/config/investing";
import {
  PRACTICE_ETFS,
  PRACTICE_UNIVERSE,
  STRATEGY_ASSETS,
  type PracticeClass,
  type StrategyAssetId,
} from "@/config/portfolios";
import type { StrategyId } from "@/config/strategies";
import type { Aligned } from "./engine";
import { limitsFor, targetWeights } from "./library";
import type { Params } from "./types";

// What the practice autopilot follows today for a level's chosen strategy (Phase AW, Stage A).
// Pure. The weights are the strategy's as of the month's first trading day, from the closes
// before it (as the replay rebalanced), so they hold all month and the 5-point band rebalances
// to them. They are by practice kind, for the ledger. A strategy the practice portfolio can't
// follow yet (a fund it can't hold, or a floor that needs the portfolio's own high) leaves the
// level's mix in place, and says why.

export type FollowToday =
  | { follow: true; weights: Record<PracticeClass, number>; signalDate: string }
  | { follow: false; why: string };

const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];

export function followToday(
  chosen: { id: StrategyId; params: Params },
  data: Aligned,
  level: RiskLevel,
  today: string,
): FollowToday {
  if (chosen.id === "static") return { follow: false, why: "The level's mix is the choice." };
  if (chosen.id === "cppi")
    return { follow: false, why: "A drawdown floor needs the portfolio's own high." };
  // The month's first trading day in the closes, or today when it hasn't closed yet.
  const month = today.slice(0, 7);
  let t = data.dates.findIndex((d) => d >= `${month}-01`);
  if (t < 0) t = data.dates.length;
  if (t < 2) return { follow: false, why: "Not enough stored closes before this month." };
  const weights = targetWeights(chosen.id, chosen.params, {
    date: data.dates[t] ?? today,
    closes: data.closes,
    t,
    limits: limitsFor(level),
    portfolio: { value: 1, peak: 1 },
  });
  const out = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<PracticeClass, number>;
  for (const [a, w] of Object.entries(weights) as [StrategyAssetId, number][]) {
    const asset = STRATEGY_ASSETS[a];
    if (!asset.practiceClass || !PRACTICE_UNIVERSE.has(asset.ticker))
      return {
        follow: false,
        why: `It holds ${asset.ticker}, which the practice portfolio can't yet.`,
      };
    out[asset.practiceClass] += w;
  }
  return { follow: true, weights: out, signalDate: data.dates[t] ?? today };
}
