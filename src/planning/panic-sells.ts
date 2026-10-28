import { PANIC_DROP_SHARE, PANIC_LOOKBACK_DAYS, PANIC_MIN_SALE_CENTS } from "@/config/panic-sells";
import { formatCents } from "@/lib/money";

// What selling after a big drop cost against holding, from the person's own sales (investing).
// Pure: their sales and the closing prices since, out the sales that came after a drop, each with
// what the shares would be worth today and the gap. Facts about the past, never a prediction.

export type Sale = { ticker: string; date: string; quantity: number; priceCents: number };
export type Bar = { date: string; closeCents: number };

export type PanicSale = {
  ticker: string;
  date: string;
  quantity: number;
  soldForCents: number;
  // How far the price had fallen from its high in the days before the sale.
  dropShare: number;
  // What those shares are worth at the latest close.
  worthTodayCents: number;
  // Positive: holding would have been worth more. Negative: selling came out ahead.
  costCents: number;
  sentence: string;
};

export type PanicResult = {
  sales: PanicSale[];
  // The sum of the costs that were positive (what holding would have added), in cents.
  costCents: number;
  // The sum of the ones where selling came out ahead.
  avoidedCents: number;
};

const DAY_MS = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function panicSells(
  sales: readonly Sale[],
  barsByTicker: Readonly<Record<string, readonly Bar[]>>,
): PanicResult {
  const out: PanicSale[] = [];
  for (const s of sales) {
    const soldFor = Math.round(s.quantity * s.priceCents);
    const bars = barsByTicker[s.ticker];
    if (!bars || bars.length === 0 || soldFor < PANIC_MIN_SALE_CENTS || s.quantity <= 0) continue;
    const from = addDays(s.date, -PANIC_LOOKBACK_DAYS);
    const before = bars.filter((b) => b.date >= from && b.date <= s.date);
    const high = Math.max(0, ...before.map((b) => b.closeCents), s.priceCents);
    const drop = high > 0 ? 1 - s.priceCents / high : 0;
    if (drop < PANIC_DROP_SHARE) continue;
    const latest = bars[bars.length - 1];
    if (latest.date <= s.date) continue;
    const worthToday = Math.round(s.quantity * latest.closeCents);
    const cost = worthToday - soldFor;
    out.push({
      ticker: s.ticker,
      date: s.date,
      quantity: s.quantity,
      soldForCents: soldFor,
      dropShare: drop,
      worthTodayCents: worthToday,
      costCents: cost,
      sentence: `On ${day(s.date)} you sold ${s.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${s.quantity === 1 ? "share" : "shares"} of ${s.ticker} for ${formatCents(soldFor)}, after it had fallen ${pct(drop)} from its high. At the ${day(latest.date)} close those shares are worth ${formatCents(worthToday)}, ${cost >= 0 ? `${formatCents(cost)} more` : `${formatCents(-cost)} less`} than you sold them for.`,
    });
  }
  out.sort((a, b) => b.costCents - a.costCents);
  return {
    sales: out,
    costCents: out.reduce((n, s) => n + Math.max(0, s.costCents), 0),
    avoidedCents: out.reduce((n, s) => n + Math.max(0, -s.costCents), 0),
  };
}

// The one-line fact for the page and the chat: the total, with both sides said.
export function panicSummary(r: PanicResult): string | null {
  if (r.sales.length === 0) return null;
  const parts = [];
  if (r.costCents > 0)
    parts.push(
      `holding would have left you ${formatCents(r.costCents)} better off on ${r.sales.filter((s) => s.costCents > 0).length === 1 ? "one sale" : `${r.sales.filter((s) => s.costCents > 0).length} sales`}`,
    );
  if (r.avoidedCents > 0)
    parts.push(
      `selling saved you ${formatCents(r.avoidedCents)} on ${r.sales.filter((s) => s.costCents < 0).length === 1 ? "another" : `${r.sales.filter((s) => s.costCents < 0).length} others`}`,
    );
  return `After a big drop you sold ${r.sales.length === 1 ? "once" : `${r.sales.length} times`}: ${parts.join(", and ")}. That is looking back at your own sales; it says nothing about what prices do next.`;
}
