import { eventTypesFor, type EventMarket } from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import { realCryptoBars, realFixtureBars } from "@/lib/market/__fixtures__/real";
import type { Bar } from "@/lib/market/types";
import { runEventBacktest, type BacktestResult } from "@/planning/event-backtest";
import {
  coverageSpikes,
  priceShocks,
  withCoolOff,
  type MarketEvent,
} from "@/planning/event-detect";
import type { Weights } from "@/planning/event-overlay";
import { mixWeights } from "@/planning/paper";
import { gdeltFixtureCoverage } from "./index";

// The events overlay's backtests (docs/backtests/events.md), on the recorded GDELT coverage and
// the real closes: tests and the CLI only, never the app.

export const BACKTEST_FROM = "2017-03-01";
export const BACKTEST_TO = "2026-10-21";
export const BACKTEST_LEVELS: readonly RiskLevel[] = [2, 3, 4];
// The level whose record seeds the paper account's confidence (src/config/event-evidence.ts).
export const EVIDENCE_LEVEL: RiskLevel = 3;

// Crypto (the 24-hour agent on bitcoin and ether): the recorded closes start in 2018.
export const CRYPTO_FROM = "2018-03-01";
export const CRYPTO_LEVEL: RiskLevel = 5;
// Two strategies to lay the events over: just holding bitcoin, and a mix with cash (where a
// bitcoin slice can come from ether or cash). The second seeds the crypto confidence.
export const CRYPTO_BASES: readonly { name: string; weights: Weights }[] = [
  { name: "Hold bitcoin", weights: { "BTC/USD": 1 } },
  {
    name: "Bitcoin 50%, ether 30%, cash 20%",
    weights: { "BTC/USD": 0.5, "ETH/USD": 0.3, BIL: 0.2 },
  },
];
export const CRYPTO_EVIDENCE_BASE = 1;

// Every day's closes the backtests read: the funds, plus bitcoin and ether under the 24-hour
// agent's names.
let bars: Record<string, Bar[]> | null = null;
export function backtestBars(): Record<string, Bar[]> {
  if (bars) return bars;
  const crypto = realCryptoBars();
  bars = { ...realFixtureBars(), "BTC/USD": crypto.BTC ?? [], "ETH/USD": crypto.ETH ?? [] };
  return bars;
}

// Every event the overlay could have seen in a market: GDELT spikes for each of its types and
// price shocks, one per type per cool-off, each with the time it became known.
export function historicalEvents(market: EventMarket = "stocks"): MarketEvent[] {
  const coverage = gdeltFixtureCoverage();
  const types = new Set(eventTypesFor(market));
  const from = market === "crypto" ? CRYPTO_FROM : BACKTEST_FROM;
  return withCoolOff([
    ...[...types].flatMap((t) => coverageSpikes(t, coverage[t] ?? [])),
    ...priceShocks(backtestBars()).filter((e) => types.has(e.type)),
  ]).filter((e) => e.date >= from && e.date <= BACKTEST_TO);
}

export function backtest(
  level: RiskLevel,
  { from = BACKTEST_FROM, to = BACKTEST_TO }: { from?: string; to?: string } = {},
): BacktestResult {
  return runEventBacktest({
    bars: backtestBars(),
    events: historicalEvents("stocks"),
    level,
    base: mixWeights(level),
    from,
    to,
  });
}

export function cryptoBacktest(
  base: Weights,
  { from = CRYPTO_FROM, to = BACKTEST_TO }: { from?: string; to?: string } = {},
): BacktestResult {
  return runEventBacktest({
    bars: backtestBars(),
    events: historicalEvents("crypto"),
    level: CRYPTO_LEVEL,
    base,
    from,
    to,
    periodsPerYear: 365,
  });
}
