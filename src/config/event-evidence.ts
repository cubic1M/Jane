import type { EventTypeId } from "@/config/events";

// The events overlay's past record (docs/backtests/events.md), written by the backtest
// (src/lib/events/__fixtures__/events-doc.ts) and checked against a fresh run by
// src/planning/event-evidence.test.ts: don't edit by hand. Per event type, at level
// 3: every event scored (traded or followed) and how many helped. It seeds the paper account's confidence
// (src/planning/event-overlay.ts confidenceFor), so a type starts from its record, not a guess.

export const EVENT_EVIDENCE: Readonly<Record<EventTypeId, { events: number; hits: number }>> = {
  me_conflict: {
    events: 72,
    hits: 42.5,
  },
  war: {
    events: 17,
    hits: 9,
  },
  fed_cut: {
    events: 40,
    hits: 14,
  },
  fed_hike: {
    events: 68,
    hits: 37.5,
  },
  oil_shock: {
    events: 73,
    hits: 34.5,
  },
  inflation_hot: {
    events: 87,
    hits: 46.3,
  },
  market_panic: {
    events: 55,
    hits: 25,
  },
  bank_stress: {
    events: 14,
    hits: 6,
  },
  chip_boom: {
    events: 61,
    hits: 35,
  },
};

export const EVENT_EVIDENCE_RANGE = {
  from: "2017-03-01",
  to: "2026-10-21",
  level: 3,
} as const;

export const EVENT_EVIDENCE_SUMMARY = {
  alone: {
    yearly: 0.0836,
    maxDrawdown: -0.2185,
    sharpe: 0.57,
  },
  withEvents: {
    yearly: 0.0855,
    maxDrawdown: -0.2237,
    sharpe: 0.58,
  },
} as const;
