import {
  LENDER_INTEREST_MIN_DAYS,
  LENDER_INTEREST_MIN_PAYMENTS,
  LENDER_PAYMENT_GAP_DAYS,
  LENDER_PAYMENT_SEEN_LEAD_DAYS,
} from "@/config/tax";
import { yearElapsed } from "./tax-income";

// A year's interest on loans (student loan interest and mortgage interest both come off income),
// one way for the student loan card and the tax estimate, so Taxes says one figure.
//
// The lender's own year to date comes first, for the year asked only (a reading from another year
// is that year's), and never paced by today: Plaid's figure is as of when it was read, so paced by
// today, frozen data's year of interest fell about $0.58 a day (gate C's calendar sweep, 12-01 to
// 12-31: "about $882.91 for the year", then "$880.26").
// - With a last payment in the read's year, the figure is so many payments' interest: paced by
//   payments, not days (manager, 11-20: $860.07 through a loan's 11th monthly payment on Nov 8 is
//   $938.26 for 12, not $1,009.40 by day 312 of 365). The payments so far are the ones Jane sees,
//   when they come monthly and the data starts before them; else the last payment's month number,
//   as if monthly from January. The year has those plus a payment for each month left.
// - Without one, paced by the day it was read (the sync that wrote the row: nothing else updates
//   it; a Method credit report writes its own accounts' rows, with no interest, and a disconnect
//   deletes them).
// Too early for either (under LENDER_INTEREST_MIN_PAYMENTS payments, or LENDER_INTEREST_MIN_DAYS
// days), a year's interest is the balance times the rate, as it is when the lender reports nothing.

export type LenderLoan = {
  // Interest paid since January 1 of its year, as the lender reports it.
  ytdInterestPaidCents: number | null;
  // YYYY-MM-DD: the day the lender's figures were read.
  readOn: string | null;
  // YYYY-MM-DD: the loan's last payment, as the lender reports it.
  lastPaymentDate: string | null;
  balanceCents: number | null;
  aprBps: number | null;
};

// The payments to these loans Jane sees (YYYY-MM-DD), and where Jane's data starts.
export type PaymentsSeen = { dates: readonly string[]; dataFrom: string | null };

export type YearInterest =
  | {
      from: "lender";
      cents: number;
      reportedCents: number;
      // Paced by payments: how many, and the last one; else the day it was read.
      payments: number | null;
      asOf: string;
    }
  | { from: "rate"; cents: number; balanceCents: number; aprBps: number; loans: number };

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const daysInto = (day: string) =>
  dayNumber(day) - Date.UTC(Number(day.slice(0, 4)), 0, 1) / DAY_MS + 1;
const MONTHS = 12;

// The payments so far this year, through the last one, and the year's.
function paymentsOf(
  lastPayment: string,
  seen: PaymentsSeen | null,
): { soFar: number; inYear: number } {
  const month = Number(lastPayment.slice(5, 7));
  const dates = (seen?.dates ?? [])
    .filter((d) => d.slice(0, 4) === lastPayment.slice(0, 4) && d <= lastPayment)
    .slice()
    .sort();
  const monthly =
    dates.length > 0 &&
    dates.every((d, i) => {
      if (i === 0) return true;
      const gap = dayNumber(d) - dayNumber(dates[i - 1]!);
      return gap >= LENDER_PAYMENT_GAP_DAYS.min && gap <= LENDER_PAYMENT_GAP_DAYS.max;
    });
  const sawFromStart =
    seen?.dataFrom != null &&
    dates.length > 0 &&
    dayNumber(dates[0]!) - dayNumber(seen.dataFrom) >= LENDER_PAYMENT_SEEN_LEAD_DAYS;
  const soFar = monthly && sawFromStart ? dates.length : month;
  return { soFar, inYear: soFar + (MONTHS - month) };
}

export function yearInterest(
  loans: readonly LenderLoan[],
  year: number,
  today: string,
  seen: PaymentsSeen | null = null,
): YearInterest | null {
  // Each loan is paced by its own last payment or read day, and a loan with nothing usable of its
  // own (no figure yet, or too early) is its balance times its rate; the year is those added up.
  // A reading dated after today (a clock set back) counts as read today.
  const parts = loans.map((l) => {
    if ((l.ytdInterestPaidCents ?? 0) <= 0 || !l.readOn) return null;
    const readOn = l.readOn > today ? today : l.readOn;
    if (Number(readOn.slice(0, 4)) !== year) return null;
    const reported = l.ytdInterestPaidCents!;
    const paid =
      l.lastPaymentDate && l.lastPaymentDate <= readOn && l.lastPaymentDate.startsWith(`${year}-`)
        ? l.lastPaymentDate
        : null;
    if (paid) {
      const { soFar, inYear } = paymentsOf(paid, seen);
      if (soFar < LENDER_INTEREST_MIN_PAYMENTS) return null;
      return {
        cents: Math.round((reported * inYear) / soFar),
        reported,
        payments: soFar as number | null,
        asOf: paid,
      };
    }
    if (daysInto(readOn) < LENDER_INTEREST_MIN_DAYS) return null;
    const share = yearElapsed(year, readOn);
    return {
      cents: share > 0 && share < 1 ? Math.round(reported / share) : reported,
      reported,
      payments: null as number | null,
      asOf: readOn,
    };
  });
  const rateOf = (l: LenderLoan) =>
    l.aprBps !== null && l.balanceCents !== null
      ? { balance: Math.abs(l.balanceCents), aprBps: l.aprBps }
      : null;
  const used = parts.flatMap((p) => (p ? [p] : []));
  if (used.length > 0) {
    const others = loans.flatMap((l, i) => {
      const r = parts[i] ? null : rateOf(l);
      return r ? [(r.balance * r.aprBps) / 10_000] : [];
    });
    // The latest payment or reading names the date, and its payment count.
    const latest = used.reduce((a, p) => (p.asOf > a.asOf ? p : a));
    return {
      from: "lender",
      cents: Math.round(used.reduce((t, p) => t + p.cents, 0) + others.reduce((t, c) => t + c, 0)),
      reportedCents: used.reduce((t, p) => t + p.reported, 0),
      payments: latest.payments,
      asOf: latest.asOf,
    };
  }
  const rated = loans.flatMap((l) => {
    const r = rateOf(l);
    return r ? [r] : [];
  });
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
