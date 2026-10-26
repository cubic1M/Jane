import { PRACTICE_ETFS } from "@/config/portfolios";
import type { Bar, Filing, Headline, MarketData } from "./types";
import { DAY_MS } from "@/lib/dates";

// The sample market (spec step 289): synthetic daily prices and recorded headlines, the same
// for the same date, with planted events (a 2022-style crash and recovery, a dip this autumn and
// next spring) so every scan and backtest has something to find. Nothing here is a real price.

export const SAMPLE_START = "2018-01-02";
export const SAMPLE_END = "2028-12-29";

// Per ticker: the first close in dollars, the yearly drift, how much it moves a day (as a share),
// how much of its move is the whole market's, and how hard the planted events hit it.
type Profile = { base: number; drift: number; vol: number; beta: number; hit: number };
export const SAMPLE_PROFILES: Readonly<Record<string, Profile>> = {
  VTI: { base: 130, drift: 0.09, vol: 0.011, beta: 1, hit: 1 },
  VXUS: { base: 55, drift: 0.05, vol: 0.011, beta: 0.85, hit: 0.9 },
  BND: { base: 80, drift: 0.025, vol: 0.003, beta: 0.1, hit: 0.35 },
  BIL: { base: 91.5, drift: 0.02, vol: 0.0002, beta: 0, hit: 0 },
  // Similar funds for a tax-loss swap (step 292): the same kind, not the same fund.
  ITOT: { base: 60, drift: 0.09, vol: 0.011, beta: 1, hit: 1 },
  IXUS: { base: 62, drift: 0.05, vol: 0.011, beta: 0.85, hit: 0.9 },
  AGG: { base: 107, drift: 0.025, vol: 0.003, beta: 0.1, hit: 0.35 },
  AAPL: { base: 43, drift: 0.2, vol: 0.017, beta: 1.2, hit: 1.2 },
  MSFT: { base: 85, drift: 0.2, vol: 0.016, beta: 1.1, hit: 1.1 },
  NVDA: { base: 50, drift: 0.4, vol: 0.028, beta: 1.5, hit: 1.5 },
  TSLA: { base: 21, drift: 0.3, vol: 0.035, beta: 1.6, hit: 1.6 },
  // The crypto sleeve's coins (src/config/crypto-strategies.ts, Very high only): far jumpier,
  // and hit hardest by the planted events.
  BTCUSD: { base: 14000, drift: 0.3, vol: 0.055, beta: 0.4, hit: 1.6 },
  ETHUSD: { base: 750, drift: 0.3, vol: 0.07, beta: 0.45, hit: 1.8 },
  // The day-trading sleeve's fund (src/config/intraday-strategies.ts, Very high only), with its
  // 5-minute bars made from these closes (./sample-intraday.ts).
  SPY: { base: 268, drift: 0.09, vol: 0.011, beta: 1, hit: 1 },
  // The strategy catalog's other funds (src/config/strategy-catalog.ts), so a person can follow
  // a catalog strategy in practice on the sample market too. Rough shapes by kind of fund.
  QQQ: { base: 150, drift: 0.14, vol: 0.012, beta: 1.15, hit: 1.15 },
  IWM: { base: 140, drift: 0.085, vol: 0.014, beta: 1.15, hit: 1.1 },
  IJR: { base: 70, drift: 0.09, vol: 0.014, beta: 1.15, hit: 1.1 },
  IJS: { base: 60, drift: 0.085, vol: 0.015, beta: 1.15, hit: 1.15 },
  IVE: { base: 120, drift: 0.075, vol: 0.004, beta: 0.95, hit: 0.95 },
  USMV: { base: 50, drift: 0.08, vol: 0.004, beta: 0.75, hit: 0.75 },
  SYLD: { base: 35, drift: 0.08, vol: 0.008, beta: 1, hit: 1 },
  XLB: { base: 55, drift: 0.06, vol: 0.01, beta: 1, hit: 1.05 },
  XLF: { base: 25, drift: 0.07, vol: 0.011, beta: 1.1, hit: 1.2 },
  XLI: { base: 70, drift: 0.08, vol: 0.009, beta: 1.05, hit: 1.05 },
  XLK: { base: 65, drift: 0.15, vol: 0.011, beta: 1.15, hit: 1.1 },
  XLP: { base: 55, drift: 0.06, vol: 0.006, beta: 0.6, hit: 0.6 },
  XLU: { base: 50, drift: 0.06, vol: 0.008, beta: 0.5, hit: 0.6 },
  XLV: { base: 80, drift: 0.08, vol: 0.007, beta: 0.75, hit: 0.75 },
  XLY: { base: 100, drift: 0.1, vol: 0.01, beta: 1.15, hit: 1.15 },
  EFA: { base: 65, drift: 0.05, vol: 0.006, beta: 0.85, hit: 0.9 },
  VEU: { base: 50, drift: 0.05, vol: 0.006, beta: 0.85, hit: 0.9 },
  VGK: { base: 55, drift: 0.05, vol: 0.007, beta: 0.85, hit: 0.95 },
  EWJ: { base: 55, drift: 0.04, vol: 0.007, beta: 0.7, hit: 0.8 },
  EEM: { base: 42, drift: 0.05, vol: 0.01, beta: 0.9, hit: 1.1 },
  VWO: { base: 42, drift: 0.05, vol: 0.01, beta: 0.9, hit: 1.1 },
  SCZ: { base: 55, drift: 0.05, vol: 0.008, beta: 0.85, hit: 0.95 },
  DLS: { base: 60, drift: 0.05, vol: 0.008, beta: 0.85, hit: 0.95 },
  DGS: { base: 45, drift: 0.05, vol: 0.01, beta: 0.9, hit: 1.05 },
  VNQ: { base: 80, drift: 0.06, vol: 0.01, beta: 0.9, hit: 1.1 },
  IYR: { base: 75, drift: 0.06, vol: 0.01, beta: 0.9, hit: 1.1 },
  REM: { base: 40, drift: 0.03, vol: 0.012, beta: 0.8, hit: 1.3 },
  IEF: { base: 105, drift: 0.02, vol: 0.004, beta: 0, hit: 0 },
  SHY: { base: 84, drift: 0.015, vol: 0.001, beta: 0, hit: 0 },
  TIP: { base: 110, drift: 0.02, vol: 0.003, beta: 0.05, hit: 0.1 },
  LQD: { base: 115, drift: 0.03, vol: 0.005, beta: 0.15, hit: 0.4 },
  HYG: { base: 85, drift: 0.045, vol: 0.005, beta: 0.4, hit: 0.8 },
  DBC: { base: 16, drift: 0.02, vol: 0.012, beta: 0.3, hit: 0.6 },
  GSG: { base: 16, drift: 0.02, vol: 0.013, beta: 0.3, hit: 0.6 },
  DBMF: { base: 28, drift: 0.04, vol: 0.008, beta: 0, hit: 0 },
  // The strategy menu's tilt funds (src/config/strategy-menu.ts).
  VTV: { base: 120, drift: 0.075, vol: 0.004, beta: 0.95, hit: 0.95 },
  MTUM: { base: 150, drift: 0.1, vol: 0.006, beta: 1.05, hit: 1.05 },
  QUAL: { base: 130, drift: 0.09, vol: 0.004, beta: 0.95, hit: 0.95 },
  VIG: { base: 160, drift: 0.085, vol: 0.004, beta: 0.9, hit: 0.9 },
  RSP: { base: 140, drift: 0.08, vol: 0.005, beta: 1, hit: 1 },
  // The news themes' funds (src/config/themes.ts).
  XLE: { base: 45, drift: 0.04, vol: 0.016, beta: 0.9, hit: 1.1 },
  ITA: { base: 70, drift: 0.08, vol: 0.012, beta: 0.9, hit: 0.9 },
  GLD: { base: 120, drift: 0.05, vol: 0.009, beta: 0.1, hit: 0 },
  TLT: { base: 120, drift: 0.01, vol: 0.009, beta: 0.1, hit: 0 },
  SMH: { base: 60, drift: 0.2, vol: 0.02, beta: 1.4, hit: 1.4 },
};

export const PRACTICE_TICKERS = Object.values(PRACTICE_ETFS).map((e) => e.ticker);

// Planted events as a tent in log price: it falls by `drop` linearly from `from` to `low`, and
// climbs back linearly to `to`. `hit` scales it per ticker.
type Event = { from: string; low: string; to: string; drop: number; label: string };
export const SAMPLE_EVENTS: readonly Event[] = [
  { from: "2020-02-19", low: "2020-03-23", to: "2020-08-31", drop: 0.3, label: "the 2020 shock" },
  { from: "2022-01-03", low: "2022-10-12", to: "2023-12-29", drop: 0.32, label: "the 2022 slide" },
  {
    from: "2025-02-18",
    low: "2025-04-08",
    to: "2025-06-30",
    drop: 0.12,
    label: "the spring 2025 dip",
  },
  {
    from: "2026-10-09",
    low: "2026-10-14",
    to: "2026-11-13",
    drop: 0.09,
    label: "this autumn's dip",
  },
  {
    from: "2027-03-01",
    low: "2027-03-12",
    to: "2027-04-16",
    drop: 0.1,
    label: "next spring's dip",
  },
];

// A seeded number in [0, 1).
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += 0x6d2b79f5;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const normal = (key: string) =>
  (unit(`${key}:a`) + unit(`${key}:b`) + unit(`${key}:c`) + unit(`${key}:d`) - 2) * Math.sqrt(3);

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const isWeekday = (n: number) => {
  const d = new Date(n * DAY_MS).getUTCDay();
  return d !== 0 && d !== 6;
};

// The tent for one event at one day, 0 to 1: how far into the event's drop the price is.
function depth(e: Event, n: number): number {
  const a = dayNumber(e.from);
  const b = dayNumber(e.low);
  const c = dayNumber(e.to);
  if (n <= a || n >= c) return 0;
  return n <= b ? (n - a) / (b - a) : (c - n) / (c - b);
}

const series = new Map<string, Bar[]>();

function build(ticker: string): Bar[] {
  const p = SAMPLE_PROFILES[ticker];
  if (!p) return [];
  const first = dayNumber(SAMPLE_START);
  const last = dayNumber(SAMPLE_END);
  const out: Bar[] = [];
  let level = 0;
  for (let n = first; n <= last; n += 1) {
    if (!isWeekday(n)) continue;
    const day = isoOf(n);
    const market = normal(`market:${day}`);
    const own = normal(`${ticker}:${day}`);
    level += p.drift / 252 + p.beta * 0.009 * market + p.vol * 0.6 * own;
    const events = SAMPLE_EVENTS.reduce(
      (s, e) => s + Math.log(1 - e.drop * p.hit * 0.999 * depth(e, n) || 1),
      0,
    );
    const price = p.base * Math.exp(level + (p.beta === 0 ? 0 : events));
    out.push({ date: day, closeCents: Math.max(1, Math.round(price * 100)) });
  }
  return out;
}

function barsFor(ticker: string): Bar[] {
  let bars = series.get(ticker);
  if (!bars) {
    bars = build(ticker);
    series.set(ticker, bars);
  }
  return bars;
}

// Recorded headlines, dated, including ones on the planted events' days.
const HEADLINES: readonly Omit<Headline, "id" | "source" | "url">[] = [
  {
    ticker: "NVDA",
    date: "2026-10-08",
    title: "Nvidia says demand for its newest chips is running ahead of supply",
  },
  {
    ticker: "TSLA",
    date: "2026-10-09",
    title: "Tesla recalls vehicles over a software fault; shares slip",
  },
  {
    ticker: null,
    date: "2026-10-12",
    title: "Stocks fall for a third day as investors weigh slower growth",
  },
  {
    ticker: "VTI",
    date: "2026-10-14",
    title: "US stock market ends the week's slide at its lowest in six months",
  },
  {
    ticker: "AAPL",
    date: "2026-10-15",
    title: "Apple's supplier cuts its outlook for the next quarter",
  },
  { ticker: "BND", date: "2026-10-13", title: "Bond yields ease as investors seek safety" },
  {
    ticker: "MSFT",
    date: "2026-10-16",
    title: "Microsoft announces a large new data-center investment",
  },
  // The news themes' kinds of event (src/config/themes.ts), in the sample's own October.
  {
    ticker: null,
    date: "2026-10-15",
    title: "Chip makers surge as demand for AI chips hits a record",
  },
  {
    ticker: null,
    date: "2026-10-16",
    title: "Troops cross the border as a war breaks out overseas",
  },
  {
    ticker: "NVDA",
    date: "2026-03-05",
    title: "Nvidia shares jump after a better-than-expected earnings report",
  },
  { ticker: "TSLA", date: "2026-03-18", title: "Tesla delivers fewer cars than analysts expected" },
  { ticker: null, date: "2025-04-07", title: "Markets swing sharply as trade worries spread" },
  {
    ticker: null,
    date: "2022-10-12",
    title: "Stocks hit their low for the year as rates keep rising",
  },
  { ticker: "AAPL", date: "2027-03-10", title: "Apple names a new head of services" },
];

const FILINGS: readonly Omit<Filing, "id" | "url">[] = [
  { ticker: "TSLA", date: "2026-10-09", form: "8-K", title: "Current report: recall of vehicles" },
  { ticker: "NVDA", date: "2026-08-27", form: "10-Q", title: "Quarterly report" },
  { ticker: "AAPL", date: "2026-08-01", form: "10-Q", title: "Quarterly report" },
  { ticker: "MSFT", date: "2026-10-16", form: "8-K", title: "Current report: capital investment" },
];

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

// The sample market read without waiting, for pure replays (the detector harness's sample
// people, src/profile/sample-practice.ts): the same closes and headlines the class gives.
export function sampleBars(ticker: string, from: string, to: string): Bar[] {
  return barsFor(ticker.toUpperCase()).filter((b) => inRange(b.date, from, to));
}

export function sampleNews(tickers: readonly string[], from: string, to: string): Headline[] {
  const wanted = new Set(tickers.map((t) => t.toUpperCase()));
  return HEADLINES.filter(
    (h) => inRange(h.date, from, to) && (h.ticker === null || wanted.has(h.ticker)),
  ).map((h, i) => ({
    ...h,
    id: `sample-news-${h.date}-${h.ticker ?? "market"}-${i}`,
    source: "Sample newswire",
    url: null,
  }));
}

export class SampleMarketData implements MarketData {
  readonly name = "sample";
  readonly simulated = true;

  async prices(ticker: string, from: string, to: string): Promise<Bar[]> {
    return sampleBars(ticker, from, to);
  }

  async latest(ticker: string, on: string): Promise<Bar | null> {
    const bars = barsFor(ticker.toUpperCase());
    let found: Bar | null = null;
    for (const b of bars) {
      if (b.date > on) break;
      found = b;
    }
    return found;
  }

  async news(tickers: readonly string[], from: string, to: string): Promise<Headline[]> {
    return sampleNews(tickers, from, to);
  }

  async filings(ticker: string, from: string, to: string): Promise<Filing[]> {
    return FILINGS.filter(
      (f) => f.ticker === ticker.toUpperCase() && inRange(f.date, from, to),
    ).map((f) => ({ ...f, id: `sample-filing-${f.ticker}-${f.date}`, url: null }));
  }
}
