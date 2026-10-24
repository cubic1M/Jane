import type { Bar } from "./types";
import { MarketDataError } from "./types";

// Yahoo Finance's keyless daily chart (Phase AW, Stage A: the strategy research's longer
// history only, src/lib/investments/strategy-research.cli.test.ts): split- and dividend-adjusted
// closes, and the day's open, high, low and close, by New York trading day. Never called by the
// app; the research labels every number from it as Yahoo's.

type Chart = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
        }[];
        adjclose?: { adjclose?: (number | null)[] }[];
      };
    }[];
    error?: { description?: string } | null;
  };
};
type Fetcher = (
  url: string,
) => Promise<{ ok?: boolean; status?: number; json(): Promise<unknown> }>;

export const yahooUrl = (ticker: string, from: string, to: string) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000)}&period2=${Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000)}&interval=1d&events=div%2Csplit`;

const NY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type YahooDay = { date: string; o: number; h: number; l: number; c: number; adj: number };

export function parseYahoo(json: Chart): YahooDay[] {
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const adj = r?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const cents = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Math.round(v * 100);
  const out: YahooDay[] = [];
  ts.forEach((t, i) => {
    const c = cents(q.close?.[i]);
    const a = cents(adj[i]);
    if (!c || !a) return;
    out.push({
      date: NY.format(new Date(t * 1000)),
      o: cents(q.open?.[i]) ?? c,
      h: cents(q.high?.[i]) ?? c,
      l: cents(q.low?.[i]) ?? c,
      c,
      adj: a,
    });
  });
  return out;
}

export async function fetchYahooDaily(
  ticker: string,
  from: string,
  to: string,
  fetcher: Fetcher = fetch as unknown as Fetcher,
): Promise<YahooDay[]> {
  const res = await fetcher(yahooUrl(ticker, from, to));
  const json = (await res.json().catch(() => null)) as Chart | null;
  if (res.ok === false || !json)
    throw new MarketDataError(`Yahoo answered ${res.status ?? "an error"} for ${ticker}.`);
  if (json.chart?.error)
    throw new MarketDataError(`Yahoo: ${json.chart.error.description ?? "error"} for ${ticker}.`);
  return parseYahoo(json);
}

// Adjusted closes as bars.
export const yahooBars = (days: readonly YahooDay[]): Bar[] =>
  days.map((d) => ({ date: d.date, closeCents: d.adj }));
