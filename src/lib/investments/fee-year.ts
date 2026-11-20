import { FEE_CADENCE_TOLERANCE } from "@/config/market-assumptions";
import { daysBetween } from "@/lib/dates";

// A year of fees counts a fee charged on a cadence that cadence's number of times: a quarterly fee
// posted a few days early one year and on time the next lands 364 days apart, so a 365-day window
// can hold five quarters. Per account and fee kind, a regular cadence keeps only its newest year's
// worth; irregular fees (a transfer here and there) are all kept. Pure.

type Dated = { accountId: string; subtype: string | null; date: string };

const YEAR_DAYS = 365.25;

export function oneYearOf<T extends Dated>(rows: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.accountId}|${r.subtype ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const kept: T[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    kept.push(...sorted.slice(Math.max(0, sorted.length - perYear(sorted))));
  }
  return kept;
}

// How many a year the group's cadence brings: all of them when it has no regular cadence.
function perYear(sorted: readonly Dated[]): number {
  if (sorted.length < 3) return sorted.length;
  const gaps = sorted.slice(1).map((r, i) => daysBetween(sorted[i]!.date, r.date));
  const middle = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
  if (middle <= 0) return sorted.length;
  const regular = gaps.every((g) => Math.abs(g - middle) <= middle * FEE_CADENCE_TOLERANCE);
  return regular ? Math.min(sorted.length, Math.round(YEAR_DAYS / middle)) : sorted.length;
}
