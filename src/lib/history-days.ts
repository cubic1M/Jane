import { daysBetween } from "@/lib/dates";

// How much history there is to see bills in: Home's cash-flow strip and Spending's lowest balance
// ahead both wait for it (CASH_FLOW_MIN_HISTORY_DAYS).

// Days from the first transaction to the last (an old statement's span, not up to today).
export function historyDaysOf(input: {
  historyFrom?: string;
  transactions: { date: string }[];
}): number {
  const dates = input.transactions.map((t) => t.date);
  if (dates.length === 0) return 0;
  const first = input.historyFrom ?? dates.reduce((a, b) => (b < a ? b : a));
  const last = dates.reduce((a, b) => (b > a ? b : a));
  return daysBetween(first, last);
}
