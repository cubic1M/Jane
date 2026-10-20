import {
  CALENDAR_ITEMS,
  ESTIMATE_PAY_GRACE_DAYS,
  ESTIMATE_PAY_LEAD_DAYS,
  TAX_CALENDAR,
  type CalendarKey,
} from "@/config/tax-calendar";

// The tax year that runs itself (spec step 223). Pure: the calendar for a month, and which
// estimated payment is in its pay window.

const DAY_MS = 86_400_000;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type CalendarPlan = {
  month: number;
  label: string;
  items: { key: CalendarKey; title: string; ask: string; auto: string }[];
};

export function planFor(month: number): CalendarPlan {
  const keys = TAX_CALENDAR[month] ?? [];
  return {
    month,
    label: MONTH_NAMES[month - 1],
    items: keys.map((key) => ({ key, ...CALENDAR_ITEMS[key] })),
  };
}

// The payments in their window today: within ESTIMATE_PAY_LEAD_DAYS before the due date, up
// to ESTIMATE_PAY_GRACE_DAYS after it (a missed one), earliest first.
export function inPayWindow<T extends { date: string }>(
  payments: readonly T[],
  today: string,
): T[] {
  return payments
    .filter((p) => {
      const until = days(today, p.date);
      return until <= ESTIMATE_PAY_LEAD_DAYS && until >= -ESTIMATE_PAY_GRACE_DAYS;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The next payment still ahead of its window, for "I'll pay it on ...".
export function nextAhead<T extends { date: string }>(
  payments: readonly T[],
  today: string,
): T | null {
  return (
    payments
      .filter((p) => days(today, p.date) > ESTIMATE_PAY_LEAD_DAYS)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  );
}
