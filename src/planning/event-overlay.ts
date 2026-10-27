import {
  EVENT_CONFIDENCE_CEILING,
  EVENT_CONFIDENCE_FLOOR,
  EVENT_HOLD_DAYS,
  EVENT_MAX_EXPOSURE_BY_LEVEL,
  EVENT_MIN_CONFIDENCE,
  EVENT_PRIOR_CONFIDENCE,
  EVENT_PRIOR_WEIGHT,
  EVENT_STOP,
  EVENT_TILT_BY_LEVEL,
  EVENT_TYPES,
  type EventTypeId,
} from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import { CATALOG_MIX_FUNDS } from "@/config/strategy-catalog";
import { knownBy, type MarketEvent } from "./event-detect";
import { formatPercentTenths } from "@/lib/percent";

// The events overlay's rules (src/config/events.ts), pure: one step per trading day. It takes
// the strategy's own targets and tilts them a little for each event it acts on, then undoes the
// tilt after EVENT_HOLD_DAYS trading days or at the stop. It adjusts, never replaces: the
// strategy keeps at least 1 − the level's max exposure of its own mix. No borrowing and no
// shorting: a trim takes at most what the strategy holds. The backtest and the paper account run
// this same step.

export type Weights = Readonly<Record<string, number>>;
export type Prices = Readonly<Record<string, number>>;

// One open slice from one event, on one fund.
export type EventSlice = {
  eventKey: string;
  type: EventTypeId;
  ticker: string;
  side: "buy" | "trim";
  // Share of the account.
  tilt: number;
  enteredOn: string;
  entryCents: number;
  confidence: number;
  reason: string;
  // The paper account's own record of what it traded (src/lib/events/run.ts); the backtest
  // trades by weight and leaves these out.
  units?: number;
  baseEntry?: Record<string, number>;
};

export type ClosedSlice = EventSlice & {
  exitedOn: string;
  exitCents: number;
  stopped: boolean;
  // The fund's move over the slice, as a fraction, and the strategy's over the same days.
  fundReturn: number;
  baseReturn: number;
  // Helped: a bought fund beat the strategy; a trimmed one did worse than the strategy.
  hit: boolean;
  // Followed only (the event was skipped): counted in the record, never traded.
  watched?: boolean;
};

export type OverlayAction =
  | { kind: "enter"; slice: EventSlice; event: MarketEvent }
  | { kind: "exit" | "stop"; slice: ClosedSlice }
  | { kind: "skip"; event: MarketEvent; why: string; confidence: number };

export type OverlayState = {
  open: EventSlice[];
  // Skipped events, followed as if they had been acted on (nothing is traded), so a type's record
  // keeps counting every event it had: one that is under the bar can earn its way back.
  watching?: EventSlice[];
  closed: ClosedSlice[];
  // Event keys already acted on or skipped, so each is decided once.
  seen: string[];
};

export const emptyOverlay = (): OverlayState => ({ open: [], watching: [], closed: [], seen: [] });

const DAY_MS = 86_400_000;
// Trading days between two dates, as weekdays after `from` up to and including `to`.
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (
    let t = Date.parse(`${from}T00:00:00Z`) + DAY_MS;
    t <= Date.parse(`${to}T00:00:00Z`);
    t += DAY_MS
  ) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += 1;
  }
  return n;
}

// A type's past record from before the slices given: its events and how many helped.
export type Seed = Partial<Record<EventTypeId, { events: number; hits: number }>>;

// How sure, for one type, from its own closed slices before now (and a seed record from the
// past, when given): a coin flip worth EVENT_PRIOR_WEIGHT events, moved by each hit and miss, kept
// between the floor and the ceiling. Events are counted once even when they had several legs.
export function confidenceFor(
  type: EventTypeId,
  closed: readonly ClosedSlice[],
  seed: Seed = {},
): number {
  const byEvent = new Map<string, boolean[]>();
  for (const c of closed)
    if (c.type === type) byEvent.set(c.eventKey, [...(byEvent.get(c.eventKey) ?? []), c.hit]);
  const results = [...byEvent.values()].map((hits) => hits.filter(Boolean).length / hits.length);
  const hits = results.reduce((a, r) => a + r, 0) + (seed[type]?.hits ?? 0);
  const events = results.length + (seed[type]?.events ?? 0);
  const p = (hits + EVENT_PRIOR_CONFIDENCE * EVENT_PRIOR_WEIGHT) / (events + EVENT_PRIOR_WEIGHT);
  return Math.min(EVENT_CONFIDENCE_CEILING, Math.max(EVENT_CONFIDENCE_FLOOR, Math.round(p * 100)));
}

export type TypeRecord = {
  type: EventTypeId;
  events: number;
  hits: number;
  hitRate: number | null;
};

// Each type's record: its events and the share whose slices helped, by event.
export function recordByType(closed: readonly ClosedSlice[]): TypeRecord[] {
  const out: TypeRecord[] = [];
  for (const type of Object.keys(EVENT_TYPES) as EventTypeId[]) {
    const byEvent = new Map<string, boolean[]>();
    for (const c of closed)
      if (c.type === type) byEvent.set(c.eventKey, [...(byEvent.get(c.eventKey) ?? []), c.hit]);
    const scores = [...byEvent.values()].map((h) => h.filter(Boolean).length / h.length);
    const hits = scores.reduce((a, s) => a + s, 0);
    out.push({
      type,
      events: scores.length,
      hits: Math.round(hits * 10) / 10,
      hitRate: scores.length ? hits / scores.length : null,
    });
  }
  return out;
}

// The strategy's targets with the open slices on: each bought slice is added and paid for by
// scaling the whole mix down by the same share; each trim moves that share of a fund (at most
// what the mix holds) to cash. The result still sums to the mix's total.
export function tiltedTargets(base: Weights, open: readonly EventSlice[]): Record<string, number> {
  const cash = CATALOG_MIX_FUNDS.cash;
  const bought = open.filter((s) => s.side === "buy").reduce((a, s) => a + s.tilt, 0);
  const out: Record<string, number> = {};
  for (const [t, w] of Object.entries(base)) out[t] = w * (1 - bought);
  for (const s of open) {
    if (s.side === "buy") out[s.ticker] = (out[s.ticker] ?? 0) + s.tilt;
    else {
      const taken = Math.min(s.tilt, out[s.ticker] ?? 0);
      out[s.ticker] = (out[s.ticker] ?? 0) - taken;
      out[cash] = (out[cash] ?? 0) + taken;
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, w]) => w > 1e-9));
}

// The fund a leg uses: the first of its tickers with a price.
export const legTicker = (tickers: readonly string[], prices: Prices) =>
  tickers.find((t) => (prices[t] ?? 0) > 0) ?? null;

export type StepInput = {
  date: string;
  level: RiskLevel;
  // The strategy's own targets today.
  base: Weights;
  prices: Prices;
  // Every event so far; only those known by today's close are used.
  events: readonly MarketEvent[];
  // The strategy's own return over a slice's days, for scoring it when it closes.
  baseReturn: (from: string, to: string, slice: EventSlice) => number;
  // The record before these slices (the backtest's, for the paper account).
  seed?: Seed;
};

// One trading day: exits first (time, then stops), then new events known by today's close, each
// decided once. Returns the new state, what it did and the targets to trade to.
export function overlayStep(
  state: OverlayState,
  input: StepInput,
): { state: OverlayState; actions: OverlayAction[]; targets: Record<string, number> } {
  const actions: OverlayAction[] = [];
  const open: EventSlice[] = [];
  const watching: EventSlice[] = [];
  const closed = [...state.closed];
  // Exits by the same rule for traded and followed slices; only a traded one is an action.
  const exits = (slices: readonly EventSlice[], keep: EventSlice[], watched: boolean) => {
    for (const s of slices) {
      const price = input.prices[s.ticker];
      if (!price) {
        keep.push(s);
        continue;
      }
      const move = price / s.entryCents - 1;
      const stopped = s.side === "buy" ? move <= -EVENT_STOP : move >= EVENT_STOP;
      const due = weekdaysBetween(s.enteredOn, input.date) >= EVENT_HOLD_DAYS;
      if (!stopped && !due) {
        keep.push(s);
        continue;
      }
      const baseReturn = input.baseReturn(s.enteredOn, input.date, s);
      const c: ClosedSlice = {
        ...s,
        exitedOn: input.date,
        exitCents: price,
        stopped,
        fundReturn: move,
        baseReturn,
        hit: s.side === "buy" ? move > baseReturn : move < baseReturn,
        ...(watched ? { watched: true } : {}),
      };
      closed.push(c);
      if (!watched) actions.push({ kind: stopped ? "stop" : "exit", slice: c });
    }
  };
  exits(state.open, open, false);
  exits(state.watching ?? [], watching, true);

  const seen = new Set(state.seen);
  const fresh = input.events
    .filter((e) => !seen.has(e.key) && knownBy(e, input.date))
    .sort((a, b) => a.knownAt.localeCompare(b.knownAt));
  const maxExposure = EVENT_MAX_EXPOSURE_BY_LEVEL[input.level];
  for (const e of fresh) {
    seen.add(e.key);
    const type = EVENT_TYPES[e.type];
    const confidence = confidenceFor(e.type, closed, input.seed);
    const used = open.reduce((a, s) => a + s.tilt, 0);
    const room = maxExposure - used;
    const tilt = EVENT_TILT_BY_LEVEL[input.level];
    const why =
      confidence < EVENT_MIN_CONFIDENCE
        ? `its record so far is ${confidence}% sure, under ${EVENT_MIN_CONFIDENCE}%`
        : open.some((s) => s.type === e.type)
          ? "a slice for the same kind of event is already open"
          : Math.min(tilt, room) / type.legs.length <= 0.0005
            ? `events already move ${formatPercentTenths(used)} of the account, the most at this level`
            : null;
    const perLeg = (why ? tilt : Math.min(tilt, room)) / type.legs.length;
    const slices: EventSlice[] = [];
    for (const leg of type.legs) {
      const ticker = legTicker(leg.tickers, input.prices);
      if (!ticker) continue;
      if (leg.side === "trim" && !((input.base[ticker] ?? 0) > 0)) continue;
      slices.push({
        eventKey: e.key,
        type: e.type,
        ticker,
        side: leg.side,
        tilt: leg.side === "trim" ? Math.min(perLeg, input.base[ticker] ?? 0) : perLeg,
        enteredOn: input.date,
        entryCents: input.prices[ticker],
        confidence,
        reason: `${e.title}. ${type.why} ${leg.side === "buy" ? "Adds" : "Takes"} ${formatPercentTenths(perLeg)} of the account ${leg.side === "buy" ? "in" : "off"} ${ticker} for up to ${EVENT_HOLD_DAYS} trading days, out sooner at a ${formatPercentTenths(EVENT_STOP)} move against it.`,
      });
    }
    if (slices.length === 0) {
      actions.push({
        kind: "skip",
        event: e,
        why: "none of its funds has a price here",
        confidence,
      });
      continue;
    }
    if (why) {
      // Not traded, but followed, so the record counts it.
      watching.push(...slices);
      actions.push({ kind: "skip", event: e, why, confidence });
      continue;
    }
    for (const slice of slices) {
      open.push(slice);
      actions.push({ kind: "enter", slice, event: e });
    }
  }
  return {
    state: { open, watching, closed, seen: [...seen] },
    actions,
    targets: tiltedTargets(input.base, open),
  };
}
