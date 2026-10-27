import {
  EVENT_COOL_OFF_DAYS,
  EVENT_TYPES,
  EVENT_TYPE_IDS,
  GDELT_BASELINE_DAYS,
  GDELT_MIN_ARTICLES,
  GDELT_MIN_HOURLY_ARTICLES,
  GDELT_SPIKE_RATIO,
  PRICE_SHOCKS,
  type EventTypeId,
} from "@/config/events";
import type { Bar } from "@/lib/market/types";

// Spotting events (the events overlay, src/config/events.ts), pure. Every event carries the time
// it was known: the overlay and the backtest may act on it only at a close after that time, so
// nothing is ever traded on before it was public.

export type EventSource = "gdelt" | "fed" | "bls" | "eia" | "price" | "news";

export type MarketEvent = {
  // `${source}:${type}:${date}`: the same event is stored and acted on once.
  key: string;
  type: EventTypeId;
  source: EventSource;
  // The day it happened (GDELT: the UTC day of the coverage; a feed: the release; a price: the
  // close).
  date: string;
  // The first moment it was public, ISO.
  knownAt: string;
  title: string;
  url: string | null;
  // How strong: a coverage spike's ratio to its baseline, a price move's size, or 1.
  strength: number;
};

// One day of GDELT coverage for a query: its articles and all articles that day.
export type Coverage = { date: string; count: number; total: number };

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const nextDay = (iso: string) => isoOf(dayNumber(iso) + 1);

// A US market close, as a UTC time. 4pm New York is 20:00Z in summer and 21:00Z in winter: the
// earlier is used, so an event from the last hour of a winter session waits for the next close.
export const closeTime = (date: string) => `${date}T20:00:00.000Z`;

// Whether an event may be acted on at the close of `date`.
export const knownBy = (e: Pick<MarketEvent, "knownAt">, date: string) =>
  e.knownAt <= closeTime(date);

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// GDELT coverage spikes: a day whose share of all coverage is GDELT_SPIKE_RATIO times the median
// share of the GDELT_BASELINE_DAYS before it (and at least GDELT_MIN_ARTICLES articles). Each day
// is judged on itself and the days before it only. A UTC day's coverage is complete only after it
// ends, so it is known 15 minutes after midnight (GDELT updates every 15 minutes).
export function coverageSpikes(type: EventTypeId, coverage: readonly Coverage[]): MarketEvent[] {
  const rows = [...coverage]
    .filter((c) => c.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: MarketEvent[] = [];
  for (let i = GDELT_BASELINE_DAYS; i < rows.length; i += 1) {
    const day = rows[i];
    const before = rows.slice(i - GDELT_BASELINE_DAYS, i).map((r) => r.count / r.total);
    const base = median(before);
    const share = day.count / day.total;
    if (day.count < GDELT_MIN_ARTICLES || base <= 0) continue;
    const ratio = share / base;
    if (ratio < GDELT_SPIKE_RATIO) continue;
    out.push({
      key: `gdelt:${type}:${day.date}`,
      type,
      source: "gdelt",
      date: day.date,
      knownAt: `${nextDay(day.date)}T00:15:00.000Z`,
      title: `${EVENT_TYPES[type].label}: news coverage ${ratio.toFixed(1)} times its usual level`,
      url: null,
      strength: Math.round(ratio * 10) / 10,
    });
  }
  return out;
}

// Within-the-day spikes (the crypto types, around the clock): GDELT's 15-minute buckets summed
// into UTC hours. An hour is an event when its share of all coverage is GDELT_SPIKE_RATIO times the
// median daily share of the GDELT_BASELINE_DAYS before its day (from the daily coverage), with at
// least GDELT_MIN_HOURLY_ARTICLES articles. Only hours that have ended by `now` are judged, and an
// hour is known 15 minutes after it ends (GDELT's update). One event per type a day: the key is
// the day's, the same as the daily spike's, so the daily one later adds nothing.
export function hourlySpikes(
  type: EventTypeId,
  buckets: readonly { at: string; count: number; total: number }[],
  daily: readonly Coverage[],
  now: string,
): MarketEvent[] {
  const hours = new Map<string, { count: number; total: number }>();
  for (const b of buckets) {
    const hour = `${b.at.slice(0, 13)}:00:00.000Z`;
    const h = hours.get(hour) ?? { count: 0, total: 0 };
    hours.set(hour, { count: h.count + b.count, total: h.total + b.total });
  }
  const days = [...daily].filter((c) => c.total > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out: MarketEvent[] = [];
  const seenDays = new Set<string>();
  for (const [hour, h] of [...hours.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const end = new Date(Date.parse(hour) + 3_600_000);
    const knownAt = new Date(end.getTime() + 15 * 60_000).toISOString();
    if (end.toISOString() > now || h.total <= 0) continue;
    const day = hour.slice(0, 10);
    if (seenDays.has(day)) continue;
    const before = days
      .filter((c) => c.date < day)
      .slice(-GDELT_BASELINE_DAYS)
      .map((c) => c.count / c.total);
    if (before.length < GDELT_BASELINE_DAYS / 2 || h.count < GDELT_MIN_HOURLY_ARTICLES) continue;
    const base = median(before);
    if (base <= 0) continue;
    const ratio = h.count / h.total / base;
    if (ratio < GDELT_SPIKE_RATIO) continue;
    seenDays.add(day);
    out.push({
      key: `gdelt:${type}:${day}`,
      type,
      source: "gdelt",
      date: day,
      knownAt,
      title: `${EVENT_TYPES[type].label}: news coverage ${ratio.toFixed(1)} times its usual level in the hour to ${end.toISOString().slice(11, 16)} UTC`,
      url: null,
      strength: Math.round(ratio * 10) / 10,
    });
  }
  return out;
}

// Sharp moves in the funds PRICE_SHOCKS watches, close to close. Known after that close.
export function priceShocks(bars: Readonly<Record<string, readonly Bar[]>>): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (const shock of PRICE_SHOCKS) {
    const series = bars[shock.ticker] ?? [];
    for (let i = 1; i < series.length; i += 1) {
      const move = series[i].closeCents / series[i - 1].closeCents - 1;
      if (shock.move < 0 ? move > shock.move : move < shock.move) continue;
      const date = series[i].date;
      out.push({
        key: `price:${shock.type}:${date}`,
        type: shock.type,
        source: "price",
        date,
        knownAt: `${date}T21:00:00.000Z`,
        title: `${shock.ticker} ${move < 0 ? "fell" : "rose"} ${Math.abs(Math.round(move * 1000) / 10)}% in a day`,
        url: null,
        strength: Math.round(Math.abs(move) * 1000) / 10,
      });
    }
  }
  return out;
}

// The event types a headline or feed item is about: every pattern of one of a type's keyword
// sets matches. Scores are the number of sets matched, for ordering; most text matches none.
export function classifyText(text: string): { type: EventTypeId; score: number }[] {
  const out: { type: EventTypeId; score: number }[] = [];
  for (const type of EVENT_TYPE_IDS) {
    const score = EVENT_TYPES[type].keywords.filter((set) => set.every((p) => p.test(text))).length;
    if (score > 0) out.push({ type, score });
  }
  // A rate decision is one direction: a statement that says both (a past cut, a new hike) is
  // read by its decision sentence alone, which classifyText's caller passes when it has one.
  return out.sort((a, b) => b.score - a.score);
}

// One event per type within EVENT_COOL_OFF_DAYS: the first, by when it was known. Keeps the
// earliest source, so a coverage spike and the Fed's own release of the same decision count once.
export function withCoolOff(events: readonly MarketEvent[]): MarketEvent[] {
  const last = new Map<EventTypeId, number>();
  const out: MarketEvent[] = [];
  for (const e of [...events].sort((a, b) => a.knownAt.localeCompare(b.knownAt))) {
    const n = dayNumber(e.date);
    const prev = last.get(e.type);
    if (prev !== undefined && n - prev < EVENT_COOL_OFF_DAYS) continue;
    last.set(e.type, n);
    out.push(e);
  }
  return out;
}
