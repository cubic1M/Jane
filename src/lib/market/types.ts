// Market data behind one interface (spec step 289, Phase AW, Stage A). Prices, headlines and
// filings for the practice portfolios and their daily scan. Stage A runs on the Sample
// implementation (deterministic, no network); Alpaca and SEC EDGAR are written against recorded
// responses and do nothing until keys are set. Swapping the implementation changes no other
// file: everything else asks `marketData()` (./index.ts) and uses these types.

export type Bar = {
  // YYYY-MM-DD, a trading day.
  date: string;
  // The day's closing price in cents.
  closeCents: number;
};

export type Headline = {
  id: string;
  // The company or ETF it is about, when one.
  ticker: string | null;
  date: string;
  title: string;
  source: string;
  url: string | null;
};

export type Filing = {
  id: string;
  ticker: string;
  date: string;
  form: "8-K" | "10-Q" | "10-K";
  title: string;
  url: string | null;
};

export interface MarketData {
  // Which one this is, for the log: "sample", "alpaca", "edgar".
  readonly name: string;
  // True for the sample market: nothing here is a real price.
  readonly simulated: boolean;
  // Daily closes from..to inclusive (YYYY-MM-DD), oldest first.
  prices(ticker: string, from: string, to: string): Promise<Bar[]>;
  // The last close on or before `on`, or null if there is none.
  latest(ticker: string, on: string): Promise<Bar | null>;
  news(tickers: readonly string[], from: string, to: string): Promise<Headline[]>;
  filings(ticker: string, from: string, to: string): Promise<Filing[]>;
}

// Thrown by a real adapter that has no key: nothing calls out without one.
export class MarketDataNotConfigured extends Error {}
