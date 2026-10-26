import {
  EVENT_HOLD_DAYS,
  EVENT_MAX_EXPOSURE_BY_LEVEL,
  EVENT_MIN_CONFIDENCE,
  EVENT_STOP,
  EVENT_TILT_BY_LEVEL,
  EVENT_TYPES,
  type EventTypeId,
} from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import type { MarketEvent } from "./event-detect";
import { confidenceFor, type ClosedSlice, type Seed, type Weights } from "./event-overlay";
import type { AgentSignal } from "./trading-agent/types";

// The events overlay as signals for the 24-hour trading agent (src/planning/trading-agent/,
// runAgent's `signals`), pure. Each event the overlay would act on becomes one AgentSignal per
// fund: in force from the moment the event became public (the agent acts at the first bar closing
// at or after it, so nothing is traded on before it was known) for EVENT_HOLD_DAYS trading days,
// holding the fund at the overlay's slice. The same rules as the overlay: a type acts only while
// its record is at least EVENT_MIN_CONFIDENCE, one slice per type at a time, and all slices in force
// together at most the level's EVENT_MAX_EXPOSURE_BY_LEVEL. A trim holds the fund at the strategy's
// own weight less the slice (never below zero), so it needs the strategy's weights; without them a
// trim is left out. The overlay's stop (EVENT_STOP) goes with each signal: the agent undoes its trade
// once a close moves that far against the fill.

const DAY_MS = 86_400_000;

// The end of a slice: EVENT_HOLD_DAYS weekdays after the day it became public, at that day's end.
export function untilFor(knownAt: string): string {
  let t = Date.parse(`${knownAt.slice(0, 10)}T00:00:00Z`);
  for (let n = 0; n < EVENT_HOLD_DAYS;) {
    t += DAY_MS;
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += 1;
  }
  return new Date(t + DAY_MS - 1).toISOString();
}

export type SignalOptions = {
  level: RiskLevel;
  // The type records the confidence starts from (src/config/event-evidence.ts) and, live, the
  // slices closed since.
  seed?: Seed;
  closed?: readonly ClosedSlice[];
  // The strategy's own weights, for trims.
  base?: Weights;
};

export function eventAgentSignals(
  events: readonly MarketEvent[],
  { level, seed = {}, closed = [], base }: SignalOptions,
): AgentSignal[] {
  const out: (AgentSignal & { type: EventTypeId; slice: number })[] = [];
  const tilt = EVENT_TILT_BY_LEVEL[level];
  const max = EVENT_MAX_EXPOSURE_BY_LEVEL[level];
  for (const e of [...events].sort((a, b) => a.knownAt.localeCompare(b.knownAt))) {
    const inForce = out.filter((s) => (s.until ?? "") > e.knownAt);
    if (inForce.some((s) => s.type === e.type)) continue;
    const confidence = confidenceFor(e.type, closed, seed);
    if (confidence < EVENT_MIN_CONFIDENCE) continue;
    const type = EVENT_TYPES[e.type];
    const room = max - inForce.reduce((a, s) => a + s.slice, 0);
    const perLeg = Math.min(tilt, room) / type.legs.length;
    if (perLeg <= 0.0005) continue;
    const until = untilFor(e.knownAt);
    for (const leg of type.legs) {
      const ticker = leg.tickers[0];
      let weight = perLeg;
      if (leg.side === "trim") {
        const own = base?.[ticker] ?? 0;
        if (own <= 0) continue;
        weight = Math.max(0, own - perLeg);
      }
      out.push({
        id: `${e.key}:${ticker}`,
        at: e.knownAt,
        until,
        ticker,
        weight,
        reason: `${e.title}. ${type.why} ${confidence}% sure, from its record.`,
        source: "events",
        stopPct: EVENT_STOP,
        type: e.type,
        slice: perLeg,
      });
    }
  }
  return out.map(({ type: _type, slice: _slice, ...s }) => s);
}
