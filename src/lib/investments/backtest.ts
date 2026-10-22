import {
  BACKTEST_FEE_BPS,
  BACKTEST_MIN_REAL_DAYS,
  BACKTEST_NOT_A_FORECAST,
  BACKTEST_REBALANCE_BAND_POINTS,
  BACKTEST_START_CENTS,
  BACKTEST_TRADE_COST_BPS,
  REAL_HISTORY_NOTE,
  SAMPLE_HISTORY_NOTE,
} from "@/config/backtest";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { MODEL_PORTFOLIOS, PRACTICE_ETFS, type PracticeClass } from "@/config/portfolios";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { HISTORY_START, storedHistory } from "@/lib/market/history";
import { SAMPLE_START, SampleMarketData } from "@/lib/market/sample";
import type { Bar } from "@/lib/market/types";
import { alignBars, runBacktest, type BacktestResult } from "@/planning/backtest";

// Backtests by level (spec step 295) for the investments page and Jane's chat tool: each of the
// five model portfolios replayed over stored real history when it is there ("Replay of real
// history since <date>"), else over the sample market, which is said plainly. Always a replay,
// never a forecast. The sample market is read directly, never through marketData(), so a replay
// never calls a live service. Demo advice: only under adviceMode, with its label.

export type LevelBacktest = {
  level: RiskLevel;
  label: string;
  weights: Readonly<Record<PracticeClass, number>>;
  // The level's yearly fund cost, the targets' blend of each fund's cost.
  yearlyFeeBps: number;
  result: BacktestResult;
};

export type Backtests = {
  source: "real" | "sample";
  // "Replay of real history since Jan 4, 2016" or "Replay of sample history since Jan 2, 2018".
  label: string;
  note: string;
  notAForecast: string;
  from: string;
  to: string;
  levels: LevelBacktest[];
  assumptions: {
    startCents: number;
    feeBps: Readonly<Record<PracticeClass, number>>;
    rebalanceBandPoints: number;
    tradeCostBps: number;
    taxes: "none";
    moneyAddedOrTaken: "none";
  };
};

type Options = { client?: PrismaClient; now?: Date };

const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
const LEVELS = [1, 2, 3, 4, 5] as const satisfies readonly RiskLevel[];

export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const byClass = (byTicker: Record<string, readonly Bar[]>) =>
  Object.fromEntries(CLASSES.map((c) => [c, byTicker[PRACTICE_ETFS[c].ticker] ?? []])) as Record<
    PracticeClass,
    readonly Bar[]
  >;

// Stored real history when every model fund has at least a year of shared days, else null.
async function realBars(
  to: string,
  client: PrismaClient,
): Promise<Record<PracticeClass, readonly Bar[]> | null> {
  const tickers = CLASSES.map((c) => PRACTICE_ETFS[c].ticker);
  const stored = await storedHistory(tickers, HISTORY_START, to, { client });
  if (!stored) return null;
  const bars = byClass(stored.bars);
  return alignBars(bars).length >= BACKTEST_MIN_REAL_DAYS ? bars : null;
}

async function sampleBars(to: string): Promise<Record<PracticeClass, readonly Bar[]>> {
  const sample = new SampleMarketData();
  const entries = await Promise.all(
    CLASSES.map(async (c) => [c, await sample.prices(PRACTICE_ETFS[c].ticker, SAMPLE_START, to)]),
  );
  return Object.fromEntries(entries) as Record<PracticeClass, readonly Bar[]>;
}

export const yearlyFeeBps = (weights: Readonly<Record<PracticeClass, number>>) =>
  CLASSES.reduce((s, c) => s + weights[c] * BACKTEST_FEE_BPS[c], 0);

// The five replays, up to today (the sample market runs past today; the future is never shown).
export async function loadBacktests({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<Backtests> {
  const to = now.toISOString().slice(0, 10);
  const real = await realBars(to, client);
  const bars = real ?? (await sampleBars(to));
  const levels = LEVELS.map((level): LevelBacktest | null => {
    const { weights } = MODEL_PORTFOLIOS[level];
    const result = runBacktest({
      weights,
      bars,
      startCents: BACKTEST_START_CENTS,
      feeBps: BACKTEST_FEE_BPS,
      bandPoints: BACKTEST_REBALANCE_BAND_POINTS,
      tradeCostBps: BACKTEST_TRADE_COST_BPS,
    });
    return result
      ? {
          level,
          label: RISK_LEVELS[level].label,
          weights,
          yearlyFeeBps: yearlyFeeBps(weights),
          result,
        }
      : null;
  }).filter((l): l is LevelBacktest => l !== null);
  const from = levels[0]?.result.from ?? to;
  return {
    source: real ? "real" : "sample",
    label: `Replay of ${real ? "real" : "sample"} history since ${longDate(from)}`,
    note: real ? REAL_HISTORY_NOTE : SAMPLE_HISTORY_NOTE,
    notAForecast: BACKTEST_NOT_A_FORECAST,
    from,
    to: levels[0]?.result.to ?? to,
    levels,
    assumptions: {
      startCents: BACKTEST_START_CENTS,
      feeBps: BACKTEST_FEE_BPS,
      rebalanceBandPoints: BACKTEST_REBALANCE_BAND_POINTS,
      tradeCostBps: BACKTEST_TRADE_COST_BPS,
      taxes: "none",
      moneyAddedOrTaken: "none",
    },
  };
}

// For one person: the replays only in demo advice mode (spec step 98); real accounts get none.
export async function backtestsFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ advice: false } | { advice: true; backtests: Backtests }> {
  if (!(await adviceMode(userId, { client }))) return { advice: false };
  return { advice: true, backtests: await loadBacktests({ client, now }) };
}
