import { DEBT_ACCOUNT_TYPES, NET_WORTH_RANGES } from "@/config/net-worth";
import { addDays } from "@/detection/units";
import type { OwnedValue, Snapshot } from "./net-worth";

// The home hub's net worth chart (docs/design/home-hub.md): net worth for every day from the
// person's first day with Jane to today. Pure.
//
// Each day, every account counts at its last balance on or before that day (carried forward
// over gaps). Before an account's first balance it counts at that first balance, and an account
// with no balance history yet counts at today's balance throughout: linking a new account is
// not a change in what the person is worth. Things owned and crypto count across the whole
// line at today's value, for the same reason (one rule with netWorthLine). The last day is
// today's net worth exactly, the hub's headline figure.

export type SeriesAccount = { id: string; type: string; currentBalanceCents: number | null };
export type SeriesPoint = { date: string; cents: number };

const isDebt = (type: string) => DEBT_ACCOUNT_TYPES.includes(type);

export function dailyNetWorth({
  accounts,
  snapshots,
  owned,
  cryptoCents = 0,
  firstDay,
  asOf,
  todayCents,
}: {
  accounts: readonly SeriesAccount[];
  snapshots: readonly Snapshot[];
  owned: readonly OwnedValue[];
  cryptoCents?: number;
  // The person's first day with Jane: their first account link or first balance, if earlier.
  firstDay: string;
  asOf: string;
  todayCents: number;
}): SeriesPoint[] {
  const start = firstDay < asOf ? firstDay : asOf;
  const byAccount = new Map<string, Snapshot[]>();
  for (const s of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  }
  const steady =
    owned.reduce((sum, o) => sum + o.valueCents, 0) +
    cryptoCents +
    accounts
      .filter((a) => !byAccount.has(a.id) && a.currentBalanceCents !== null)
      .reduce((sum, a) => sum + (isDebt(a.type) ? -1 : 1) * a.currentBalanceCents!, 0);
  const tracked = accounts.filter((a) => byAccount.has(a.id));
  // A pointer per account into its sorted balances, moved forward day by day.
  const at = new Map(tracked.map((a) => [a.id, 0]));
  const points: SeriesPoint[] = [];
  for (let day = start; day <= asOf; day = addDays(day, 1)) {
    let net = steady;
    for (const a of tracked) {
      const rows = byAccount.get(a.id)!;
      let i = at.get(a.id)!;
      while (i + 1 < rows.length && rows[i + 1].date <= day) i += 1;
      at.set(a.id, i);
      net += (isDebt(a.type) ? -1 : 1) * rows[i].balanceCents;
    }
    points.push({ date: day, cents: net });
  }
  points[points.length - 1] = { date: asOf, cents: todayCents };
  return points;
}

export type RangeKey = (typeof NET_WORTH_RANGES)[number]["key"] | "ALL";

// The ranges this person has history for: a range shows only when their line is longer than
// it. ALL always shows, last.
export function rangesFor(points: readonly SeriesPoint[]): RangeKey[] {
  const days = points.length - 1;
  return [...NET_WORTH_RANGES.filter((r) => days > r.days).map((r) => r.key), "ALL"];
}

// The points of one range: from that many days back (or the first day) to today.
export function pointsIn(points: readonly SeriesPoint[], range: RangeKey): SeriesPoint[] {
  if (range === "ALL" || points.length === 0) return [...points];
  const days = NET_WORTH_RANGES.find((r) => r.key === range)!.days;
  const from = addDays(points[points.length - 1].date, -days);
  return points.filter((p) => p.date >= from);
}

// How a range moved, to a point in it (today unless the person is scrubbing): in dollars and
// as a share of where it started. No share when it started at zero.
export function changeOver(
  points: readonly SeriesPoint[],
  to: number = points.length - 1,
): { cents: number; share: number | null } {
  if (points.length === 0) return { cents: 0, share: null };
  const start = points[0].cents;
  const cents = points[Math.min(to, points.length - 1)].cents - start;
  return { cents, share: start === 0 ? null : cents / Math.abs(start) };
}
