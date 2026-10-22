import { readFileSync } from "node:fs";
import type { Bar } from "@/lib/market/types";

// The real-closes research fixture (./README.md) as bars by ticker, for tests and tuning only:
// the app never imports this. Closes are rounded to cents, as stored history is.
export const REAL_FIXTURE_SOURCE =
  "Yahoo Finance adjusted daily closes, 2016-01-04 to 2026-10-21, downloaded 2026-10-22";

let cached: Record<string, Bar[]> | null = null;

export function realFixtureBars(): Record<string, Bar[]> {
  if (cached) return cached;
  const [header, ...rows] = readFileSync(new URL("./closes.csv", import.meta.url), "utf8")
    .trim()
    .split("\n");
  const tickers = header.split(",").slice(1);
  const bars: Record<string, Bar[]> = Object.fromEntries(tickers.map((t) => [t, []]));
  for (const row of rows) {
    const [date, ...closes] = row.split(",");
    closes.forEach((c, i) => {
      if (c) bars[tickers[i]].push({ date, closeCents: Math.round(Number(c) * 100) });
    });
  }
  cached = bars;
  return bars;
}
