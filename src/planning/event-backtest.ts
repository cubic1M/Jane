import { EVENT_COST_BPS, EVENT_TYPES, type EventTypeId } from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import type { Bar } from "@/lib/market/types";
import type { MarketEvent } from "./event-detect";
import {
  emptyOverlay,
  overlayStep,
  recordByType,
  type ClosedSlice,
  type OverlayAction,
  type OverlayState,
  type Weights,
} from "./event-overlay";

// The events overlay on past days (docs/backtests/events.md), pure: the strategy alone and the
// strategy with the overlay, side by side from the same money on the same real closes. Both
// rebalance to their targets on the first trading day of each month; the overlay also trades on
// the days it enters or leaves a slice. Every trade costs EVENT_COST_BPS. Each day uses only
// closes up to that day and events known by that day's close (event-detect.ts's knownBy), so
// cutting the history off at any day leaves every earlier decision unchanged (the tests check
// this). A replay of the past, not a forecast.

type Book = Record<string, number>; // units by ticker

export type BacktestInput = {
  bars: Readonly<Record<string, readonly Bar[]>>;
  events: readonly MarketEvent[];
  level: RiskLevel;
  // The strategy's targets (a fixed mix here).
  base: Weights;
  from: string;
  to: string;
  // The fund whose return is the risk-free rate in the Sharpe ratio.
  cashTicker?: string;
  // Trading days a year: 252 for funds, 365 for crypto (it trades every day).
  periodsPerYear?: number;
};

export type Metrics = {
  totalReturn: number;
  yearly: number;
  maxDrawdown: number;
  sharpe: number;
  volatility: number;
};

export type TypeResult = {
  type: EventTypeId;
  // Events traded, and events followed only (skipped: under the bar, or one already open).
  events: number;
  watched: number;
  skipped: number;
  // Over every event of the type, traded or followed: the share whose slices helped.
  hitRate: number | null;
  // Average help per traded event, as a fraction of the account: a bought fund's lead over the
  // strategy, a trimmed fund's lag behind it, each times the slice's size, summed over its legs.
  averageHelp: number | null;
};

export type BacktestResult = {
  from: string;
  to: string;
  days: number;
  base: Metrics;
  overlay: Metrics;
  types: TypeResult[];
  actions: { date: string; action: OverlayAction }[];
  closed: ClosedSlice[];
  values: { date: string; base: number; overlay: number }[];
};

const START = 1_000_000;

function closesOn(
  bars: Readonly<Record<string, readonly Bar[]>>,
  tickers: readonly string[],
): { dates: string[]; at: (date: string) => Record<string, number> } {
  const series = new Map(tickers.map((t) => [t, bars[t] ?? []]));
  const cursor = new Map(tickers.map((t) => [t, -1]));
  const last: Record<string, number> = {};
  // Closes are read forward only, in date order: no day ever sees a later close.
  return {
    dates: [],
    at(date: string) {
      for (const [t, s] of series) {
        let i = cursor.get(t)!;
        while (i + 1 < s.length && s[i + 1].date <= date) i += 1;
        cursor.set(t, i);
        if (i >= 0) last[t] = s[i].closeCents;
      }
      return { ...last };
    },
  };
}

const worth = (book: Book, prices: Record<string, number>) =>
  Object.entries(book).reduce((a, [t, u]) => a + u * (prices[t] ?? 0), 0);

// Trades a book to targets at today's closes, paying EVENT_COST_BPS on what changes hands.
function rebalance(book: Book, targets: Weights, prices: Record<string, number>): Book {
  const total = worth(book, prices);
  const tickers = new Set([...Object.keys(book), ...Object.keys(targets)]);
  let traded = 0;
  for (const t of tickers) {
    if (!prices[t]) continue;
    traded += Math.abs((targets[t] ?? 0) * total - (book[t] ?? 0) * prices[t]);
  }
  const after = total - (traded * EVENT_COST_BPS) / 10_000;
  const sum = Object.entries(targets).reduce((a, [t, w]) => a + (prices[t] ? w : 0), 0);
  const out: Book = {};
  for (const [t, w] of Object.entries(targets))
    if (prices[t] && w > 0) out[t] = ((w / sum) * after) / prices[t];
  // A fund with no price today is kept as it is.
  for (const [t, u] of Object.entries(book)) if (!prices[t]) out[t] = u;
  return out;
}

export function metrics(
  values: readonly number[],
  cash: readonly number[],
  periodsPerYear = 252,
): Metrics {
  const r = values.slice(1).map((v, i) => v / values[i] - 1);
  const rf = cash.slice(1).map((v, i) => (cash[i] > 0 ? v / cash[i] - 1 : 0));
  const excess = r.map((x, i) => x - (rf[i] ?? 0));
  const mean = excess.reduce((a, x) => a + x, 0) / Math.max(1, excess.length);
  const sd = Math.sqrt(
    excess.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, excess.length - 1),
  );
  const rMean = r.reduce((a, x) => a + x, 0) / Math.max(1, r.length);
  const rSd = Math.sqrt(r.reduce((a, x) => a + (x - rMean) ** 2, 0) / Math.max(1, r.length - 1));
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    worst = Math.min(worst, v / peak - 1);
  }
  const years = r.length / periodsPerYear;
  const total = values[values.length - 1] / values[0] - 1;
  return {
    totalReturn: total,
    yearly: years > 0 ? (1 + total) ** (1 / years) - 1 : 0,
    maxDrawdown: worst,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(periodsPerYear) : 0,
    volatility: rSd * Math.sqrt(periodsPerYear),
  };
}

export function runEventBacktest(input: BacktestInput): BacktestResult {
  const cashTicker = input.cashTicker ?? "BIL";
  const legTickers = Object.values(EVENT_TYPES).flatMap((t) => t.legs.flatMap((l) => l.tickers));
  const tickers = [...new Set([...Object.keys(input.base), ...legTickers, cashTicker])];
  const prices = closesOn(input.bars, tickers);
  // The trading days: those of the strategy's first fund.
  const spine = (input.bars[Object.keys(input.base)[0]] ?? [])
    .map((b) => b.date)
    .filter((d) => d >= input.from && d <= input.to);

  let baseBook: Book = {};
  let overBook: Book = {};
  let state: OverlayState = emptyOverlay();
  const values: { date: string; base: number; overlay: number }[] = [];
  const cashValues: number[] = [];
  const baseByDate = new Map<string, number>();
  const actions: { date: string; action: OverlayAction }[] = [];
  let month = "";

  for (const date of spine) {
    const p = prices.at(date);
    if (Object.keys(input.base).some((t) => !p[t])) continue;
    const first = values.length === 0;
    if (first) {
      baseBook = rebalance({ [cashTicker]: START / (p[cashTicker] ?? 1) }, input.base, p);
      overBook = { ...baseBook };
    }
    const newMonth = date.slice(0, 7) !== month;
    month = date.slice(0, 7);
    if (newMonth && !first) baseBook = rebalance(baseBook, input.base, p);
    baseByDate.set(date, worth(baseBook, p));

    const step = overlayStep(state, {
      date,
      level: input.level,
      base: input.base,
      prices: p,
      events: input.events,
      baseReturn: (from, to) => (baseByDate.get(to) ?? 0) / (baseByDate.get(from) ?? 1) - 1,
    });
    state = step.state;
    for (const a of step.actions) actions.push({ date, action: a });
    const traded = step.actions.some((a) => a.kind !== "skip");
    if (first || newMonth || traded) overBook = rebalance(overBook, step.targets, p);

    values.push({ date, base: worth(baseBook, p), overlay: worth(overBook, p) });
    cashValues.push(p[cashTicker] ?? 0);
  }

  const record = recordByType(state.closed);
  const types: TypeResult[] = record.map((r) => {
    const slices = state.closed.filter((c) => c.type === r.type);
    const byEvent = new Map<string, number>();
    for (const c of slices.filter((c) => !c.watched)) {
      const lead = c.side === "buy" ? c.fundReturn - c.baseReturn : c.baseReturn - c.fundReturn;
      byEvent.set(c.eventKey, (byEvent.get(c.eventKey) ?? 0) + lead * c.tilt);
    }
    const helps = [...byEvent.values()];
    return {
      type: r.type,
      events: byEvent.size,
      watched: new Set(slices.filter((c) => c.watched).map((c) => c.eventKey)).size,
      skipped: actions.filter((a) => a.action.kind === "skip" && a.action.event.type === r.type)
        .length,
      hitRate: r.hitRate,
      averageHelp: helps.length ? helps.reduce((a, h) => a + h, 0) / helps.length : null,
    };
  });

  return {
    from: values[0]?.date ?? input.from,
    to: values.at(-1)?.date ?? input.to,
    days: values.length,
    base: metrics(
      values.map((v) => v.base),
      cashValues,
      input.periodsPerYear,
    ),
    overlay: metrics(
      values.map((v) => v.overlay),
      cashValues,
      input.periodsPerYear,
    ),
    types,
    actions,
    closed: state.closed,
    values,
  };
}
