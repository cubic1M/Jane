import { addDays } from "@/data-sources/demo/demo-bank";
import { DEMO_PRICES, demoPriceOn } from "@/data-sources/demo/demo-holdings";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { demoAnchorFor } from "@/lib/plaid/demo";

// The market-data partner (spec step 156): daily prices for what people hold, for values,
// returns and benchmarks. An interface, so a real market-data provider can be connected
// later; until then the stand-in is the demo bank's own daily price feed
// (src/data-sources/demo/demo-prices.ts), for demo-bank people only. Real accounts get their
// prices from the bank on each sync, and no history until a provider is connected.

export type PricePoint = { day: string; priceCents: number };

export interface MarketDataPartner {
  readonly name: string;
  // True for the stand-in: made-up prices.
  readonly simulated: boolean;
  // The closing price on a day, in cents, or null when the partner doesn't carry it.
  priceCents(ticker: string, day: string): number | null;
  // Every day's close from `from` to `to`, oldest first; empty when not carried.
  history(ticker: string, from: string, to: string): PricePoint[];
}

export function demoMarketData(anchor: string): MarketDataPartner {
  const carries = (ticker: string) => Object.hasOwn(DEMO_PRICES, ticker.toUpperCase());
  const priceCents = (ticker: string, day: string) =>
    carries(ticker) ? Math.round(demoPriceOn(ticker.toUpperCase(), day, anchor) * 100) : null;
  return {
    name: "demo price feed",
    simulated: true,
    priceCents,
    history(ticker, from, to) {
      if (!carries(ticker)) return [];
      const out: PricePoint[] = [];
      for (let day = from; day <= to; day = addDays(day, 1)) {
        out.push({ day, priceCents: priceCents(ticker, day)! });
      }
      return out;
    },
  };
}

// The partner for one person: the demo feed for a demo-bank person, else none yet.
export async function marketDataFor(
  userId: string,
  client: PrismaClient = defaultClient,
): Promise<MarketDataPartner | null> {
  const anchor = await demoAnchorFor(userId, { client });
  return anchor ? demoMarketData(anchor) : null;
}

// The last close before `now`: what orders fill at and values are shown at.
export const lastClose = (now: Date) => addDays(now.toISOString().slice(0, 10), -1);
