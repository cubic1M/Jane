import type { Bar } from "@/lib/market/types";
import type { PaperPrices } from "@/lib/paper/prices";

// Made-up weekday closes for the paper account's tests (no network): each ticker starts from a
// price set by its name.

const basePrice = (ticker: string) =>
  5_000 + [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0) * 20;

function weekdays(from: string, to: string): number[] {
  const out: number[] = [];
  for (
    let d = Date.parse(`${from}T00:00:00Z`);
    d <= Date.parse(`${to}T00:00:00Z`);
    d += 86_400_000
  ) {
    const day = new Date(d).getUTCDay();
    if (day !== 0 && day !== 6) out.push(d);
  }
  return out;
}

const isoDay = (d: number) => new Date(d).toISOString().slice(0, 10);

// A steady climb, the same for the same day whatever range is asked for, times `bump`.
export const climbingPrices = (
  bump: (ticker: string, date: string) => number = () => 1,
): PaperPrices => ({
  name: "sample",
  real: false,
  closes: async (ticker: string, from: string, to: string): Promise<Bar[]> =>
    weekdays(from, to).map((d) => {
      const n = Math.round(d / 86_400_000) - 20_000;
      const date = isoDay(d);
      return { date, closeCents: Math.round(basePrice(ticker) * 1.0004 ** n * bump(ticker, date)) };
    }),
});

// The same close every day.
export const flatPrices: PaperPrices = {
  name: "sample",
  real: false,
  closes: async (ticker: string, from: string, to: string): Promise<Bar[]> =>
    weekdays(from, to).map((d) => ({ date: isoDay(d), closeCents: basePrice(ticker) })),
};
