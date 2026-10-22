import { AlpacaMarketData } from "./alpaca";
import { EdgarMarketData } from "./edgar";
import { SampleMarketData } from "./sample";
import type { MarketData } from "./types";

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

export function marketData(env: Record<string, string | undefined> = process.env): MarketData {
  const id = env.ALPACA_API_KEY_ID;
  const secret = env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) return new SampleMarketData();
  const edgar = env.EDGAR_USER_AGENT
    ? new EdgarMarketData(env.EDGAR_USER_AGENT, WATCH_CIKS)
    : undefined;
  return new AlpacaMarketData({ id, secret }, undefined, edgar, env.ALPACA_DATA_FEED || "iex");
}

export type { Bar, Filing, Headline, MarketData } from "./types";
export { MarketDataNotConfigured } from "./types";
