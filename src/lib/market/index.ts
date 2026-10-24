import { AsyncLocalStorage } from "node:async_hooks";
import { AlpacaMarketData } from "./alpaca";
import { fetchIntraday } from "./alpaca-intraday";
import { EdgarMarketData } from "./edgar";
import { SampleMarketData } from "./sample";
import { sampleSession } from "./sample-intraday";
import type { IntradayBar, MarketData } from "./types";

// The one place that chooses the market data (spec step 289). Stage A: always the sample market,
// unless BOTH Alpaca keys (ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY) are set (Stage B), and then Alpaca's prices and news with EDGAR filings
// when EDGAR_USER_AGENT is set. Every other file calls marketData() and nothing else.

// Central Index Keys for the large companies the sample watches (SEC company identifiers).
export const WATCH_CIKS: Readonly<Record<string, string>> = {
  AAPL: "0000320193",
  MSFT: "0000789019",
  NVDA: "0001045810",
  TSLA: "0001318605",
};

// A replay's own market data (./memo.ts), for everything it calls while it runs.
const replayFeed = new AsyncLocalStorage<MarketData>();
export function withMarketData<T>(feed: MarketData, run: () => Promise<T>): Promise<T> {
  return replayFeed.run(feed, run);
}

export function marketData(env: Record<string, string | undefined> = process.env): MarketData {
  const replay = replayFeed.getStore();
  if (replay) return replay;
  const id = env.ALPACA_API_KEY_ID;
  const secret = env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) return new SampleMarketData();
  const edgar = env.EDGAR_USER_AGENT
    ? new EdgarMarketData(env.EDGAR_USER_AGENT, WATCH_CIKS)
    : undefined;
  return new AlpacaMarketData({ id, secret }, undefined, edgar, env.ALPACA_DATA_FEED || "iex");
}

// A day's 5-minute bars of one fund (the Very high day-trading sleeve): the sample's own
// session without both Alpaca keys, else Alpaca's, from the open to the close. Kept apart from
// MarketData so the daily feeds stay as they are.
export function intradaySession(
  env: Record<string, string | undefined> = process.env,
): (ticker: string, day: string) => Promise<IntradayBar[]> {
  const id = env.ALPACA_API_KEY_ID;
  const secret = env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) return async (ticker, day) => sampleSession(ticker, day);
  return (ticker, day) =>
    fetchIntraday({ id, secret }, ticker, `${day}T00:00:00Z`, `${day}T23:59:59Z`, {
      feed: env.ALPACA_DATA_FEED || "iex",
    });
}

export type { Bar, Filing, Headline, IntradayBar, MarketData } from "./types";
export { MarketDataNotConfigured } from "./types";
