import { LENDER_INTEREST_MIN_DAYS } from "@/config/tax";
import { yearElapsed } from "./tax-income";

// A year's interest on loans (student loan interest and mortgage interest both come off income),
// one way for the student loan card and the tax estimate, so Taxes says one figure.
//
// The lender's own year to date comes first, paced to the year by the day it was read, never by
// today: Plaid's figure is as of the read, so paced by today, frozen data's year of interest fell
// about $0.58 a day (gate C's calendar sweep, 12-01 to 12-31: "about $882.91 for the year", then
// "$880.26"). A reading from another year than the one asked is that year's, not this one's. Too
// early in its year (under LENDER_INTEREST_MIN_DAYS) the reading is a few weeks of interest, and the
// year is worked out from the balance and rate instead, as it is when the lender reports nothing.

export type LenderLoan = {
  // Interest paid since January 1 of asOf's year, as the lender reports it.
  ytdInterestPaidCents: number | null;
  // YYYY-MM-DD: the day the lender's figure was read.
  asOf: string | null;
  balanceCents: number | null;
  aprBps: number | null;
};

export type YearInterest =
  | { from: "lender"; cents: number; reportedCents: number; asOf: string }
  | { from: "rate"; cents: number; balanceCents: number; aprBps: number; loans: number };

const daysInto = (asOf: string) =>
  Math.round(
    (Date.parse(`${asOf}T00:00:00Z`) - Date.UTC(Number(asOf.slice(0, 4)), 0, 1)) / 86_400_000,
  ) + 1;

export function yearInterest(
  loans: readonly LenderLoan[],
  year: number,
  today: string,
): YearInterest | null {
  // A reading dated after today (a clock set back) counts as read today.
  const read = loans.flatMap((l) => {
    if ((l.ytdInterestPaidCents ?? 0) <= 0 || !l.asOf) return [];
    const asOf = l.asOf > today ? today : l.asOf;
    return Number(asOf.slice(0, 4)) === year ? [{ cents: l.ytdInterestPaidCents!, asOf }] : [];
  });
  const asOf = read.reduce((a, r) => (r.asOf > a ? r.asOf : a), "");
  if (asOf && daysInto(asOf) >= LENDER_INTEREST_MIN_DAYS) {
    const reportedCents = read.reduce((t, r) => t + r.cents, 0);
    const share = yearElapsed(year, asOf);
    return {
      from: "lender",
      cents: share > 0 && share < 1 ? Math.round(reportedCents / share) : reportedCents,
      reportedCents,
      asOf,
    };
  }
  const rated = loans.flatMap((l) =>
    l.aprBps !== null && l.balanceCents !== null
      ? [{ balance: Math.abs(l.balanceCents), aprBps: l.aprBps }]
      : [],
  );
  if (rated.length === 0) return null;
  const cents = Math.round(rated.reduce((t, l) => t + (l.balance * l.aprBps) / 10_000, 0));
  return {
    from: "rate",
    cents,
    balanceCents: rated.reduce((t, l) => t + l.balance, 0),
    aprBps: rated[0]!.aprBps,
    loans: rated.length,
  };
}
