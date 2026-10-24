import type { RiskLevel } from "@/config/investing";
import { strategyTickers } from "@/config/portfolios";
import {
  STRATEGY_FOLLOW_HISTORY_DAYS,
  STRATEGY_LABELS,
  STRATEGY_RESEARCH_CHOICE,
  type StrategyId,
} from "@/config/strategies";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { storedHistory } from "@/lib/market/history";
import { alignUniverse } from "@/planning/strategies/engine";
import { followToday, type FollowToday } from "@/planning/strategies/follow";
import { keyOf } from "@/planning/strategies/select";
import { latestStrategies, type ChosenStrategy } from "./strategy-eval";

// The strategy a level's practice portfolio follows today (Phase AW, Stage A): the daily
// evaluation's choice for the level (./strategy-eval.ts), or before its first run the committed
// research choice (STRATEGY_RESEARCH_CHOICE), and its weights for the month from the stored
// closes. Remembered for the day, as every portfolio at a level reads the same. Practice money
// only.

type Options = { client?: PrismaClient; now?: Date };

export type StrategyToday = {
  chosen: Pick<ChosenStrategy, "level" | "id" | "params" | "key" | "label" | "why">;
  source: "evaluation" | "research" | "person";
} & FollowToday;

const DAY_MS = 86_400_000;
const kept = new Map<string, StrategyToday>();

// `pick`: a strategy the person chose in their settings (STRATEGY_CHOICES) instead of the
// level's, with its fixed parameters.
export async function strategyToday(
  level: RiskLevel,
  {
    client = defaultClient,
    now = new Date(),
    pick,
  }: Options & {
    pick?: { id: StrategyId; params: Readonly<Record<string, number | string>> };
  } = {},
): Promise<StrategyToday | null> {
  const latest = await latestStrategies({ client });
  const evaluated = latest?.byLevel[level];
  const research = STRATEGY_RESEARCH_CHOICE[level];
  const picked: StrategyToday["chosen"] | null = pick
    ? {
        level,
        id: pick.id,
        params: pick.params,
        key: keyOf({ id: pick.id, params: pick.params }),
        label: STRATEGY_LABELS[pick.id],
        why: "You chose it in your practice settings.",
      }
    : null;
  const chosen: StrategyToday["chosen"] = picked ??
    evaluated ?? {
      level,
      id: research.id,
      params: research.params,
      key: keyOf({ id: research.id, params: research.params }),
      label: STRATEGY_LABELS[research.id],
      why: research.why,
    };
  const source = picked
    ? ("person" as const)
    : evaluated
      ? ("evaluation" as const)
      : ("research" as const);
  const today = now.toISOString().slice(0, 10);
  const key = `${today}|${latest?.ranAt.toISOString() ?? "research"}|${level}|${picked?.key ?? ""}`;
  const known = kept.get(key);
  if (known) return known;
  let out: StrategyToday;
  if (chosen.id === "static")
    out = { chosen, source, follow: false, why: "The level's mix is the choice." };
  else {
    const from = new Date(now.getTime() - STRATEGY_FOLLOW_HISTORY_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const stored = await storedHistory(strategyTickers(), from, today, { client });
    const data = stored ? alignUniverse(stored.bars) : null;
    out = data
      ? { chosen, source, ...followToday(chosen, data, level, today) }
      : {
          chosen,
          source,
          follow: false,
          why: "Jane doesn't have enough recent prices for this strategy's funds yet, so the portfolio keeps the level's mix until the daily price load has them.",
        };
  }
  if (kept.size > 50) kept.clear();
  kept.set(key, out);
  return out;
}
