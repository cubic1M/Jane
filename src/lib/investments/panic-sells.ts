import { PANIC_HISTORY_DAYS } from "@/config/panic-sells";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { marketData, type MarketData } from "@/lib/market";
import { panicSells, type PanicResult, type Sale } from "@/planning/panic-sells";

// Selling after a big drop, from the person's own sales (investing): their sells since
// PANIC_HISTORY_DAYS, the closing prices since, and what holding would have been worth. Prices
// come from the market data (Alpaca when its keys are set; the sample market only knows its own
// tickers, so a sale of anything else is left out rather than guessed). A fact about the past.

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function loadPanicSells(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    feed = marketData(),
  }: { client?: PrismaClient; now?: Date; feed?: MarketData } = {},
): Promise<PanicResult> {
  const since = new Date(now.getTime() - PANIC_HISTORY_DAYS * DAY_MS);
  const rows = await scopedFor(userId, client).investmentTransactions.findMany({
    where: { type: "sell", date: { gte: since }, security: { is: { ticker: { not: null } } } },
    select: {
      date: true,
      quantity: true,
      priceCents: true,
      security: { select: { ticker: true } },
    },
    orderBy: { date: "asc" },
  });
  const sales: Sale[] = rows.flatMap((r) =>
    r.security?.ticker && r.priceCents > 0
      ? [
          {
            ticker: r.security.ticker.toUpperCase(),
            date: iso(r.date),
            quantity: Math.abs(r.quantity),
            priceCents: r.priceCents,
          },
        ]
      : [],
  );
  if (sales.length === 0) return { sales: [], costCents: 0, avoidedCents: 0 };
  const today = iso(now);
  const bars: Record<string, { date: string; closeCents: number }[]> = {};
  for (const ticker of new Set(sales.map((s) => s.ticker))) {
    const first = sales
      .filter((s) => s.ticker === ticker)
      .map((s) => s.date)
      .sort()[0];
    const from = iso(new Date(Date.parse(`${first}T00:00:00Z`) - 100 * DAY_MS));
    try {
      bars[ticker] = await feed.prices(ticker, from, today);
    } catch {
      // No price history for it (no key, or not a ticker the feed knows): left out.
    }
  }
  return panicSells(sales, bars);
}
