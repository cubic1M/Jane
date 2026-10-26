import { DAY_MS } from "@/lib/dates";
// How investments have done (spec step 156), counting money paid in and taken out properly.
// Pure. Facts about the past only: these say what happened, never what will.
//
// - Time-weighted return: the return of the investments themselves, as if no money had
//   come or gone. Each stretch between two valuations is measured on its own and the
//   stretches are chained, so a big deposit doesn't count as a gain.
// - Money-weighted return: what the person's own money earned, timing included: the
//   yearly rate (XIRR) that makes the starting value and every deposit grow to the end value.

export type DayValue = { day: string; valueCents: number };
// Money paid in (positive) or taken out (negative) on a day. It lands after that day's
// valuation (the daily job snapshots balances before it invests), so it counts from the
// next stretch on.
export type Flow = { day: string; amountCents: number };

const years = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS / 365;

// Null without at least two valuations, or when a stretch starts from nothing.
export function timeWeightedReturn(values: DayValue[], flows: Flow[]): number | null {
  const sorted = [...values].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length < 2) return null;
  let growth = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const inflow = flows
      .filter((f) => f.day >= prev.day && f.day < cur.day)
      .reduce((s, f) => s + f.amountCents, 0);
    const start = prev.valueCents + inflow;
    if (start <= 0) return null;
    growth *= cur.valueCents / start;
  }
  return growth - 1;
}

// The yearly rate r that makes start × (1 + r)^t + each flow × (1 + r)^(time left) equal
// the end value; and the same rate over the period. Null when there's no answer.
export function moneyWeightedReturn(
  start: DayValue,
  flows: Flow[],
  end: DayValue,
): { yearly: number; period: number } | null {
  const total = years(start.day, end.day);
  if (total <= 0) return null;
  const inside = flows.filter((f) => f.day >= start.day && f.day < end.day);
  const gap = (r: number) =>
    start.valueCents * (1 + r) ** total +
    inside.reduce((s, f) => s + f.amountCents * (1 + r) ** years(f.day, end.day), 0) -
    end.valueCents;
  // Bisection between -99% and +1,000% a year: slow but always lands.
  let low = -0.99;
  let high = 10;
  if (gap(low) * gap(high) > 0) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (gap(low) * gap(mid) <= 0) high = mid;
    else low = mid;
  }
  const yearly = (low + high) / 2;
  return { yearly, period: (1 + yearly) ** total - 1 };
}

// The return of a blend: each part's daily price moves, weighted by its share, chained.
export function blendedReturn(parts: { weight: number; prices: DayValue[] }[]): number | null {
  const days = parts[0]?.prices.map((p) => p.day) ?? [];
  if (days.length < 2) return null;
  let growth = 1;
  for (let i = 1; i < days.length; i += 1) {
    let r = 0;
    for (const part of parts) {
      const prev = part.prices[i - 1]?.valueCents;
      const cur = part.prices[i]?.valueCents;
      if (!prev || cur === undefined) continue;
      r += part.weight * (cur / prev - 1);
    }
    growth *= 1 + r;
  }
  return growth - 1;
}

// "+4.2%", "−1.3%".
export const formatReturn = (r: number) => `${r < 0 ? "−" : "+"}${Math.abs(r * 100).toFixed(1)}%`;
