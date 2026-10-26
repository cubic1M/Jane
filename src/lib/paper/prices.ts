import { fetchYahooDaily } from "@/lib/market/yahoo";
import { marketData } from "@/lib/market";
import type { Bar } from "@/lib/market/types";

// Where the paper account's prices come from (founder: real prices, "not just from the sample
// data anymore"), all free: Alpaca's daily bars when its keys are set (as the practice portfolio
// and the backtests use), else Yahoo Finance's keyless daily chart. The sample market only outside
// production, or when PAPER_SAMPLE_PRICES=1 (the e2e tests): never presented as real.

export type PaperPrices = {
  name: "alpaca" | "yahoo" | "sample";
  real: boolean;
  // Daily closes from..to inclusive, oldest first.
  closes(ticker: string, from: string, to: string): Promise<Bar[]>;
};

export function paperPrices(env: Record<string, string | undefined> = process.env): PaperPrices {
  const feed = marketData(env);
  if (!feed.simulated)
    return { name: "alpaca", real: true, closes: (t, from, to) => feed.prices(t, from, to) };
  if (env.NODE_ENV === "production" && env.PAPER_SAMPLE_PRICES !== "1")
    return {
      name: "yahoo",
      real: true,
      closes: async (t, from, to) =>
        (await fetchYahooDaily(t, from, to)).map((d) => ({ date: d.date, closeCents: d.c })),
    };
  return { name: "sample", real: false, closes: (t, from, to) => feed.prices(t, from, to) };
}

const day = (d: Date) => d.toISOString().slice(0, 10);
export const daysBefore = (iso: string, n: number) =>
  day(new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000));

// The last close of each ticker on or before `asOf` (from the last two weeks), and its date.
export async function latestCloses(
  source: PaperPrices,
  tickers: readonly string[],
  asOf: string,
): Promise<{ prices: Record<string, number>; date: string | null }> {
  const prices: Record<string, number> = {};
  let date: string | null = null;
  for (const t of [...new Set(tickers)]) {
    const bar = (await source.closes(t, daysBefore(asOf, 14), asOf)).at(-1);
    if (!bar) continue;
    prices[t] = bar.closeCents;
    if (!date || bar.date > date) date = bar.date;
  }
  return { prices, date };
}
