import { DUE_AFTER_PAYDAY_DAYS, DUE_BEFORE_PAYDAY_DAYS } from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { formatCents } from "@/lib/money";

// Due-date moves (spec step 117): a debt payment that falls just before payday leaves the
// least money in the account when it's taken. Jane finds them and drafts the request to move
// the date to just after payday, which most lenders and card issuers allow once a year. Pure.

// Days of the month the person is paid on, from their paychecks (most common first).
export function paydaysOf(incomeDates: readonly string[]): number[] {
  const count = new Map<number, number>();
  for (const d of incomeDates) {
    const day = Number(d.slice(8, 10));
    count.set(day, (count.get(day) ?? 0) + 1);
  }
  return [...count.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([day]) => day);
}

// Days from `from` to `to` going forward around the month (1–31 days).
const daysForward = (from: number, to: number) => (to - from + 31) % 31;

export type DueMove = {
  debtKey: string;
  debtName: string;
  paymentCents: number;
  dueDay: number;
  payday: number;
  suggestedDay: number;
  // The request, ready to send.
  request: string;
};

export function dueMoves(debts: readonly Debt[], paydays: readonly number[]): DueMove[] {
  if (paydays.length === 0) return [];
  return debts.flatMap((d): DueMove[] => {
    if (!d.nextDue || d.paymentCents === null || d.paymentEvery !== "month" || !d.accountId)
      return [];
    const dueDay = Number(d.nextDue.slice(8, 10));
    // The payday that comes soonest after the due date.
    const next = [...paydays].sort((a, b) => daysForward(dueDay, a) - daysForward(dueDay, b))[0];
    const gap = daysForward(dueDay, next);
    // Due on payday itself, or well before it: fine.
    if (gap === 0 || gap > DUE_BEFORE_PAYDAY_DAYS) return [];
    const suggestedDay = ((next + DUE_AFTER_PAYDAY_DAYS - 1) % 28) + 1;
    return [
      {
        debtKey: d.key,
        debtName: d.name,
        paymentCents: d.paymentCents,
        dueDay,
        payday: next,
        suggestedDay,
        request: `Hello, I'd like to change the monthly payment due date on my account (${d.name}) from the ${ordinal(dueDay)} to the ${ordinal(suggestedDay)} of each month, so it comes just after my payday. Please confirm the new date and whether the next payment changes. Thank you.`,
      },
    ];
  });
}

export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

export const dueMoveLine = (m: DueMove) =>
  `Your ${m.debtName} (${formatCents(m.paymentCents)}) is due on the ${ordinal(m.dueDay)}, just before your payday on the ${ordinal(m.payday)}. Moving it to the ${ordinal(m.suggestedDay)} leaves more room before it's taken.`;
