import { PRACTICE_ETFS, PRACTICE_UNIVERSE } from "@/config/portfolios";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import type { Bar, MarketData } from "./types";

// The one-time history load (spec step 289, Phase AW): daily closes for every practice ticker
// pulled from the market data and stored with their source and date range, so backtests run on
// real history ("real history since <date>") and fall back to the sample market only when none
// is stored. Only a real (not simulated) market data can load: the sample is never stored as
// history. Safe to run again: it fills only what is missing at either end.

type Options = { client?: PrismaClient; now?: Date };

// About ten years of daily history: enough for the 2020 shock, the 2022 slide and the recovery.
export const HISTORY_START = "2016-01-04";

const day = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const nextDay = (iso: string) => day(new Date(dateOf(iso).getTime() + 86_400_000));

// The model funds first (the backtests need them), then everything else the practice portfolio
// may hold: the swap partners and the watched companies, so the rule replay can test the tax-loss
// swaps and the news ideas on real prices too.
export const historyTickers = () => {
  const main = Object.values(PRACTICE_ETFS).map((e) => e.ticker as string);
  return [...main, ...[...PRACTICE_UNIVERSE].filter((t) => !main.includes(t)).sort()];
};

export class HistoryError extends Error {}

export type LoadReport = {
  ticker: string;
  added: number;
  from: string | null;
  to: string | null;
}[];

export async function loadHistory(
  feed: MarketData,
  { client = defaultClient, now = new Date() }: Options = {},
  {
    from = HISTORY_START,
    tickers = historyTickers(),
  }: { from?: string; tickers?: readonly string[] } = {},
): Promise<LoadReport> {
  if (feed.simulated)
    throw new HistoryError(
      "Only a real market feed can load history: the sample market is never stored.",
    );
  const to = day(now);
  const report: LoadReport = [];
  for (const ticker of tickers) {
    const done = await client.marketHistoryLoad.findUnique({
      where: { ticker_source: { ticker, source: feed.name } },
    });
    const ranges: [string, string][] = [];
    if (!done) ranges.push([from, to]);
    else {
      if (day(done.fromDate) > from) ranges.push([from, day(done.fromDate)]);
      if (day(done.toDate) < to) ranges.push([nextDay(day(done.toDate)), to]);
    }
    let added = 0;
    for (const [a, b] of ranges) {
      const bars: Bar[] = await feed.prices(ticker, a, b);
      if (bars.length === 0) continue;
      const result = await client.marketPrice.createMany({
        data: bars.map((x) => ({
          ticker,
          date: dateOf(x.date),
          closeCents: x.closeCents,
          source: feed.name,
        })),
        skipDuplicates: true,
      });
      added += result.count;
    }
    const range = await client.marketPrice.aggregate({
      where: { ticker, source: feed.name },
      _min: { date: true },
      _max: { date: true },
      _count: true,
    });
    if (range._min.date && range._max.date) {
      await client.marketHistoryLoad.upsert({
        where: { ticker_source: { ticker, source: feed.name } },
        create: {
          ticker,
          source: feed.name,
          fromDate: range._min.date,
          toDate: range._max.date,
          rows: range._count,
          loadedAt: now,
        },
        update: {
          fromDate: range._min.date,
          toDate: range._max.date,
          rows: range._count,
          loadedAt: now,
        },
      });
    }
    report.push({
      ticker,
      added,
      from: range._min.date ? day(range._min.date) : null,
      to: range._max.date ? day(range._max.date) : null,
    });
  }
  return report;
}

export type StoredHistory = {
  // "alpaca" for real history; the label to show beside any figure built from it.
  source: string;
  since: string;
  bars: Record<string, Bar[]>;
};

// The stored closes for these tickers between the dates, or null when any ticker has none (the
// caller then uses the sample market and says so).
export async function storedHistory(
  tickers: readonly string[],
  from: string,
  to: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<StoredHistory | null> {
  const bars: Record<string, Bar[]> = {};
  let source = "";
  for (const ticker of tickers) {
    const rows = await client.marketPrice.findMany({
      where: { ticker, date: { gte: dateOf(from), lte: dateOf(to) } },
      orderBy: { date: "asc" },
      select: { date: true, closeCents: true, source: true },
    });
    if (rows.length === 0) return null;
    bars[ticker] = rows.map((r) => ({ date: day(r.date), closeCents: r.closeCents }));
    source = rows[0].source;
  }
  const since = Object.values(bars).reduce((m, b) => (b[0].date > m ? b[0].date : m), "");
  return { source, since, bars };
}

export const historyLabel = (h: StoredHistory) => `real history since ${h.since}`;
