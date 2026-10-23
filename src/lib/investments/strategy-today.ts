import type { RiskLevel } from "@/config/investing";
import { strategyTickers } from "@/config/portfolios";
import { STRATEGY_FOLLOW_HISTORY_DAYS } from "@/config/strategies";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { storedHistory } from "@/lib/market/history";
import { alignUniverse } from "@/planning/strategies/engine";
import { followToday, type FollowToday } from "@/planning/strategies/follow";
import { latestStrategies, type ChosenStrategy } from "./strategy-eval";

// The strategy a level's practice portfolio follows today (Phase AW, Stage A): the weekly
// evaluation's choice for the level (./strategy-eval.ts) and its weights for the month from the
// stored closes. Null before the first evaluation. Remembered for the day, as every portfolio at
// a level reads the same. Practice money only.

type Options = { client?: PrismaClient; now?: Date };

export type StrategyToday = { chosen: ChosenStrategy } & FollowToday;

const DAY_MS = 86_400_000;
const kept = new Map<string, StrategyToday | null>();

export async function strategyToday(
  level: RiskLevel,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StrategyToday | null> {
  const latest = await latestStrategies({ client });
  const chosen = latest?.byLevel[level];
  if (!latest || !chosen) return null;
  const today = now.toISOString().slice(0, 10);
  const key = `${today}|${latest.ranAt.toISOString()}|${level}`;
  if (kept.has(key)) return kept.get(key)!;
  let out: StrategyToday;
  if (chosen.id === "static")
    out = { chosen, follow: false, why: "The level's mix is the choice." };
  else {
    const from = new Date(now.getTime() - STRATEGY_FOLLOW_HISTORY_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const stored = await storedHistory(strategyTickers(), from, today, { client });
    const data = stored ? alignUniverse(stored.bars) : null;
    out = data
      ? { chosen, ...followToday(chosen, data, level, today) }
      : { chosen, follow: false, why: "No stored closes for the strategy's funds yet." };
  }
  if (kept.size > 50) kept.clear();
  kept.set(key, out);
  return out;
}
