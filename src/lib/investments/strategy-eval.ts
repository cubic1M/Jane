import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { strategyTickers } from "@/config/portfolios";
import { STRATEGY_EVAL_MIN_DAYS, STRATEGY_LABELS, type StrategyId } from "@/config/strategies";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { HISTORY_START, storedHistory } from "@/lib/market/history";
import type { Bar } from "@/lib/market/types";
import { alignUniverse, type Metrics } from "@/planning/strategies/engine";
import { selectForLevel, type LevelSelection } from "@/planning/strategies/select";
import type { Params } from "@/planning/strategies/types";
import { isoDay as day } from "@/lib/dates";

// The daily strategy evaluation (Phase AW, Stage A), run by Vercel Cron after the 09:00 history load
// (/api/cron/strategy-eval): every strategy in the library replayed for every level over the
// Alpaca closes stored in market_prices, the walk-forward choice per level, and the results
// saved, so the practice autopilot, the backtest view and the chat read the latest choice without
// replaying anything. Market data only; practice money and demo advice. Never a forecast.

type Options = { client?: PrismaClient; now?: Date };

export type ChosenStrategy = {
  level: RiskLevel;
  id: StrategyId;
  params: Params;
  key: string;
  label: string;
  why: string;
  train: Metrics;
  test: Metrics;
  baseline: { train: Metrics; test: Metrics };
};

export type EvaluationRun =
  | { ran: false; why: string }
  | { ran: true; id: string; from: string; to: string; chosen: ChosenStrategy[] };

const LEVELS = [1, 2, 3, 4, 5] as const satisfies readonly RiskLevel[];

export function chosenOf(s: LevelSelection): ChosenStrategy {
  return {
    level: s.level,
    id: s.chosen.id,
    params: s.chosen.params,
    key: s.chosenKey,
    label: STRATEGY_LABELS[s.chosen.id],
    why: s.why,
    train: s.train,
    test: s.test,
    baseline: s.baseline,
  };
}

// The choice for every level from closes by ticker, or why there is none.
export function evaluate(bars: Readonly<Record<string, readonly Bar[]>>) {
  const data = alignUniverse(bars);
  if (!data) return { ok: false as const, why: "Not every strategy fund has stored closes yet." };
  if (data.dates.length < STRATEGY_EVAL_MIN_DAYS)
    return {
      ok: false as const,
      why: `Only ${data.dates.length} shared trading days stored; the evaluation needs ${STRATEGY_EVAL_MIN_DAYS}.`,
    };
  const selections = LEVELS.map((l) => selectForLevel(data, l)).filter(
    (s): s is LevelSelection => s !== null,
  );
  if (selections.length === 0) return { ok: false as const, why: "No level could be evaluated." };
  return { ok: true as const, data, selections };
}

export async function runStrategyEvaluation({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<EvaluationRun> {
  const stored = await storedHistory(strategyTickers(), HISTORY_START, day(now), { client });
  if (!stored) return { ran: false, why: "Not every strategy fund has stored closes yet." };
  const out = evaluate(stored.bars);
  if (!out.ok) return { ran: false, why: out.why };
  const chosen = out.selections.map(chosenOf);
  const results = out.selections.map((s) => ({
    level: s.level,
    byStartYear: s.byStartYear.map((y) => ({
      startYear: y.startYear,
      pick: y.pick,
      passed: y.passed,
      results: y.results.map((r) => ({ key: r.key, train: r.train, test: r.test })),
    })),
  }));
  const from = out.data.dates[0];
  const to = out.data.dates[out.data.dates.length - 1];
  const row = await client.strategyEvaluation.create({
    data: {
      ranAt: now,
      source: stored.source,
      fromDate: new Date(`${from}T00:00:00Z`),
      toDate: new Date(`${to}T00:00:00Z`),
      chosen: chosen as unknown as Prisma.InputJsonValue,
      results: results as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { ran: true, id: row.id, from, to, chosen };
}

export type LatestStrategies = {
  ranAt: Date;
  source: string;
  from: string;
  to: string;
  byLevel: Partial<Record<RiskLevel, ChosenStrategy>>;
};

// The latest evaluation's choice per level, or null before the first run.
export async function latestStrategies({
  client = defaultClient,
}: Pick<Options, "client"> = {}): Promise<LatestStrategies | null> {
  const row = await client.strategyEvaluation.findFirst({
    orderBy: { ranAt: "desc" },
    select: { ranAt: true, source: true, fromDate: true, toDate: true, chosen: true },
  });
  if (!row) return null;
  const chosen = row.chosen as unknown as ChosenStrategy[];
  return {
    ranAt: row.ranAt,
    source: row.source,
    from: day(row.fromDate),
    to: day(row.toDate),
    byLevel: Object.fromEntries(
      chosen.filter((c) => Object.hasOwn(RISK_LEVELS, c.level)).map((c) => [c.level, c]),
    ),
  };
}
