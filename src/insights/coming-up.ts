import { addDays, daysBetween } from "@/detection/units";
import type { Deadline } from "@/insights/deadlines";

// "Coming up" on Today (spec step 79): the next few bills and deadlines in one list,
// soonest first. Pure: the bills forecast and the deadlines list in, rows out.

export type ComingUpBill = { merchant: string; date: string; amountCents: number };

export type ComingUpRow = {
  key: string;
  // YYYY-MM-DD.
  date: string;
  label: string;
  amountCents: number | null;
  // 0 is today.
  daysLeft: number;
  // Bills go to /bills, deadlines to /deadlines.
  href: "/bills" | "/deadlines";
};

// A bill that is the same thing as a deadline on the same day (a yearly renewal, a card payment).
export const sameThing = (bill: ComingUpBill, deadline: Deadline) =>
  bill.date === deadline.date &&
  (deadline.title.toLowerCase().startsWith(bill.merchant.toLowerCase()) ||
    deadline.amountCents === bill.amountCents);

// A bill that is also a deadline on the same day (a yearly renewal, a card payment) shows
// once, as the deadline, which says what it is ("Netflix renews"). Deadlines already past
// (the person's own, not yet marked done) are left to /deadlines.
export function comingUp(
  bills: ComingUpBill[],
  deadlines: Deadline[],
  asOf: string,
  { days, limit }: { days: number; limit: number },
): ComingUpRow[] {
  const until = addDays(asOf, days);
  const within = (date: string) => date >= asOf && date <= until;
  const dated = deadlines.filter((d) => within(d.date));
  const rows: ComingUpRow[] = [
    ...dated.map((d) => ({
      key: `deadline:${d.key}`,
      date: d.date,
      label: d.title,
      amountCents: d.amountCents ?? bills.find((b) => sameThing(b, d))?.amountCents ?? null,
      daysLeft: daysBetween(asOf, d.date),
      href: "/deadlines" as const,
    })),
    ...bills
      .filter((b) => within(b.date) && !dated.some((d) => sameThing(b, d)))
      .map((b) => ({
        key: `bill:${b.merchant}:${b.date}`,
        date: b.date,
        label: b.merchant,
        amountCents: b.amountCents,
        daysLeft: daysBetween(asOf, b.date),
        href: "/bills" as const,
      })),
  ];
  return rows
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
    .slice(0, limit);
}
