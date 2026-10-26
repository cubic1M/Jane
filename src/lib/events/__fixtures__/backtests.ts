import { EVENT_TYPE_IDS } from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import { realFixtureBars } from "@/lib/market/__fixtures__/real";
import { runEventBacktest, type BacktestResult } from "@/planning/event-backtest";
import {
  coverageSpikes,
  priceShocks,
  withCoolOff,
  type MarketEvent,
} from "@/planning/event-detect";
import { mixWeights } from "@/planning/paper";
import { gdeltFixtureCoverage } from "./index";

// The events overlay's backtests (docs/backtests/events.md), on the recorded GDELT coverage and
// the real closes: tests and the CLI only, never the app.

export const BACKTEST_FROM = "2017-03-01";
export const BACKTEST_TO = "2026-10-21";
export const BACKTEST_LEVELS: readonly RiskLevel[] = [2, 3, 4];
// The level whose record seeds the paper account's confidence (src/config/event-evidence.ts).
export const EVIDENCE_LEVEL: RiskLevel = 3;

// Every event the overlay could have seen: GDELT spikes for each type and price shocks, one per
// type per cool-off, each with the time it became known.
export function historicalEvents(): MarketEvent[] {
  const coverage = gdeltFixtureCoverage();
  return withCoolOff([
    ...EVENT_TYPE_IDS.flatMap((t) => coverageSpikes(t, coverage[t])),
    ...priceShocks(realFixtureBars()),
  ]).filter((e) => e.date >= BACKTEST_FROM && e.date <= BACKTEST_TO);
}

export function backtest(
  level: RiskLevel,
  { from = BACKTEST_FROM, to = BACKTEST_TO }: { from?: string; to?: string } = {},
): BacktestResult {
  return runEventBacktest({
    bars: realFixtureBars(),
    events: historicalEvents(),
    level,
    base: mixWeights(level),
    from,
    to,
  });
}
