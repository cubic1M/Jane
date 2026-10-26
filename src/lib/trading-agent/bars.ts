import { SESSION_CLOSE_MINUTE, SESSION_OPEN_MINUTE } from "@/config/intraday-strategies";
import { AGENT_INTERVALS, type AgentInterval } from "@/config/trading-agent";
import { newYork } from "@/planning/intraday";
import { ALPACA_DATA_URL } from "@/lib/market/alpaca";
import { fetchIntraday } from "@/lib/market/alpaca-intraday";
import { MarketDataError } from "@/lib/market/types";
import type { AgentBar } from "@/planning/trading-agent/types";

// The 24-hour agent's bars (founder, 2026-10-26), all free and read-only, prices only:
// - crypto: Alpaca's crypto bars, which need no key, around the clock from 2021;
// - US funds: Alpaca's stock bars (split- and dividend-adjusted) when ALPACA_API_KEY_ID and
//   ALPACA_API_SECRET_KEY are in the environment (production, and the research workflow),
//   otherwise Yahoo Finance's keyless intraday chart (about two years of hourly bars, sixty days
//   of 15-minute bars; not adjusted for dividends).
// Nothing here can place an order: Alpaca's trading API is never called. Keys are read from the
// environment and never logged or returned.

type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok?: boolean; status?: number; json(): Promise<unknown> }>;

type AlpacaCryptoBars = {
  bars?: Record<
    string,
    { t: string; o: number; h: number; l: number; c: number; v: number }[]
  > | null;
  next_page_token?: string | null;
};

// A rate limit (429) or a brief outage (5xx) is asked again after a pause that doubles: 1, 2, 4,
// 8 and 16 seconds. Anything else is answered at once.
const RETRIES = 5;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function patiently(
  fetcher: Fetcher,
  url: string,
  init: { headers?: Record<string, string> } | undefined,
  wait: (ms: number) => Promise<unknown> = pause,
) {
  for (let k = 0; ; k += 1) {
    const res = await fetcher(url, init);
    const again = res.status === 429 || (res.status ?? 0) >= 500;
    if (!again || k >= RETRIES) return res;
    await wait(1_000 * 2 ** k);
  }
}

export const isCryptoPair = (ticker: string) => ticker.includes("/");

export const cryptoIntradayUrl = (
  pair: string,
  from: string,
  to: string,
  interval: AgentInterval,
  pageToken?: string | null,
) =>
  `${ALPACA_DATA_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(pair)}&timeframe=${AGENT_INTERVALS[interval].alpaca}&start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&limit=10000&sort=asc${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;

const cents = (x: number) => Math.round(x * 100);

export function parseCryptoBars(json: AlpacaCryptoBars, pair: string): AgentBar[] {
  return (json.bars?.[pair] ?? []).map((b) => ({
    t: new Date(b.t).toISOString(),
    o: cents(b.o),
    h: cents(b.h),
    l: cents(b.l),
    c: cents(b.c),
    v: b.v,
  }));
}

// A crypto pair's bars from..to (ISO times), oldest first. No key.
export async function fetchCryptoBars(
  pair: string,
  from: string,
  to: string,
  interval: AgentInterval,
  fetcher: Fetcher = fetch as unknown as Fetcher,
  wait?: (ms: number) => Promise<unknown>,
): Promise<AgentBar[]> {
  const out: AgentBar[] = [];
  let token: string | null = null;
  // At most 1,000 pages of 10,000 bars: years of 15-minute bars, and a stop for a bad answer.
  for (let page = 0; page < 1_000; page += 1) {
    const res = await patiently(
      fetcher,
      cryptoIntradayUrl(pair, from, to, interval, token),
      undefined,
      wait,
    );
    const json = (await res.json().catch(() => null)) as AlpacaCryptoBars | null;
    if (res.ok === false || !json)
      throw new MarketDataError(`Alpaca's crypto bars answered ${res.status ?? "an error"}.`);
    out.push(...parseCryptoBars(json, pair));
    token = json.next_page_token ?? null;
    if (!token) break;
  }
  return out;
}

type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
    error?: { description?: string } | null;
  };
};

// Yahoo keeps this much intraday history, in days.
export const YAHOO_INTRADAY_DAYS: Readonly<Record<AgentInterval, number>> = {
  "15m": 59,
  "1h": 729,
};

export const yahooIntradayUrl = (
  ticker: string,
  from: string,
  to: string,
  interval: AgentInterval,
) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${Math.floor(Date.parse(from) / 1000)}&period2=${Math.floor(Date.parse(to) / 1000)}&interval=${AGENT_INTERVALS[interval].yahoo}&includePrePost=false`;

export function parseYahooIntraday(json: YahooChart): AgentBar[] {
  const r = json.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0] ?? {};
  const out: AgentBar[] = [];
  (r?.timestamp ?? []).forEach((ts, i) => {
    const c = q.close?.[i];
    if (c === null || c === undefined) return;
    const o = q.open?.[i] ?? c;
    out.push({
      t: new Date(ts * 1000).toISOString(),
      o: cents(o),
      h: cents(q.high?.[i] ?? Math.max(o, c)),
      l: cents(q.low?.[i] ?? Math.min(o, c)),
      c: cents(c),
      v: q.volume?.[i] ?? 0,
    });
  });
  return out;
}

export async function fetchYahooIntraday(
  ticker: string,
  from: string,
  to: string,
  interval: AgentInterval,
  fetcher: Fetcher = fetch as unknown as Fetcher,
): Promise<AgentBar[]> {
  // Yahoo answers only inside its window: clip the start to it.
  const earliest = Date.parse(to) - YAHOO_INTRADAY_DAYS[interval] * 86_400_000;
  const start = new Date(Math.max(Date.parse(from), earliest)).toISOString();
  const res = await patiently(fetcher, yahooIntradayUrl(ticker, start, to, interval), {
    headers: { "User-Agent": "Mozilla/5.0 (Jane practice research)" },
  });
  const json = (await res.json().catch(() => null)) as YahooChart | null;
  if (res.ok === false || !json)
    throw new MarketDataError(`Yahoo answered ${res.status ?? "an error"} for ${ticker}.`);
  if (json.chart?.error)
    throw new MarketDataError(`Yahoo: ${json.chart.error.description ?? "error"} for ${ticker}.`);
  return parseYahooIntraday(json);
}

// Regular-hours bars joined into bars of `minutes` that start at the 9:30 open (Alpaca's hourly
// bars start on the hour, so the 9:00 one would mix the pre-market in): open of the first, high
// and low of all, close of the last, volume summed. Bars outside 9:30 to 4 are dropped.
export function sessionBars(bars: readonly AgentBar[], minutes: number): AgentBar[] {
  const out: AgentBar[] = [];
  let key = "";
  for (const b of [...bars].sort((x, y) => (x.t < y.t ? -1 : 1))) {
    const { date, minute } = newYork(b.t);
    if (minute < SESSION_OPEN_MINUTE || minute >= SESSION_CLOSE_MINUTE) continue;
    const k = `${date}:${Math.floor((minute - SESSION_OPEN_MINUTE) / minutes)}`;
    const last = out.at(-1);
    if (k === key && last) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else {
      const startMinute =
        SESSION_OPEN_MINUTE + Math.floor((minute - SESSION_OPEN_MINUTE) / minutes) * minutes;
      const t = new Date(Date.parse(b.t) - (minute - startMinute) * 60_000).toISOString();
      out.push({ ...b, t });
      key = k;
    }
  }
  return out;
}

export type BarSource = "alpaca" | "yahoo" | "alpaca-crypto";

export function alpacaKeys(env: Record<string, string | undefined> = process.env) {
  const id = env.ALPACA_API_KEY_ID;
  const secret = env.ALPACA_API_SECRET_KEY;
  return id && secret ? { id, secret } : null;
}

// Where a ticker's bars come from here: crypto from Alpaca without a key; funds from Alpaca with
// the keys, else Yahoo.
export const sourceFor = (
  ticker: string,
  env: Record<string, string | undefined> = process.env,
): BarSource => (isCryptoPair(ticker) ? "alpaca-crypto" : alpacaKeys(env) ? "alpaca" : "yahoo");

// One ticker's bars from..to (ISO times), from its source.
export async function fetchAgentBars(
  ticker: string,
  from: string,
  to: string,
  interval: AgentInterval,
  {
    env = process.env,
    fetcher = fetch as unknown as Fetcher,
  }: { env?: Record<string, string | undefined>; fetcher?: Fetcher } = {},
): Promise<{ source: BarSource; bars: AgentBar[] }> {
  const source = sourceFor(ticker, env);
  if (source === "alpaca-crypto")
    return { source, bars: await fetchCryptoBars(ticker, from, to, interval, fetcher) };
  if (source === "alpaca") {
    const bars = await fetchIntraday(alpacaKeys(env), ticker, from, to, {
      timeframe: AGENT_INTERVALS["15m"].alpaca,
      feed: env.ALPACA_DATA_FEED || "iex",
      fetcher: fetcher as never,
    });
    return { source, bars: sessionBars(bars, AGENT_INTERVALS[interval].minutes) };
  }
  return { source, bars: await fetchYahooIntraday(ticker, from, to, interval, fetcher) };
}
