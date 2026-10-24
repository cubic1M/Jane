import { readFileSync } from "node:fs";
import type { Bar } from "@/lib/market/types";

// The real-closes research fixture (./README.md) as bars by ticker, for tests and tuning only:
// the app never imports this. Closes are rounded to cents, as stored history is.
export const REAL_FIXTURE_SOURCE =
  "Yahoo Finance adjusted daily closes, 2016-01-04 to 2026-10-21, downloaded 2026-10-22";

let cached: Record<string, Bar[]> | null = null;

// Each file is a date column, then one column per ticker in dollars (blank: no close).
function read(file: string, into: Record<string, Bar[]>) {
  const [header, ...rows] = readFileSync(new URL(file, import.meta.url), "utf8")
    .trim()
    .split("\n");
  const tickers = header.split(",").slice(1);
  for (const t of tickers) into[t] = [];
  for (const row of rows) {
    const [date, ...closes] = row.split(",");
    closes.forEach((c, i) => {
      if (c) into[tickers[i]].push({ date, closeCents: Math.round(Number(c) * 100) });
    });
  }
}

// The practice tickers (closes.csv), the rest of the strategy universe (universe.csv), the
// news themes' funds (themes.csv) and the strategy menu's (menu.csv).
export function realFixtureBars(): Record<string, Bar[]> {
  if (cached) return cached;
  const bars: Record<string, Bar[]> = {};
  read("./closes.csv", bars);
  read("./universe.csv", bars);
  read("./themes.csv", bars);
  read("./menu.csv", bars);
  cached = bars;
  return bars;
}
