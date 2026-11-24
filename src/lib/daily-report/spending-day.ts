import {
  DAILY_REPORT_LARGEST,
  DAILY_REPORT_LATE_DAYS,
  DAILY_REPORT_MONTHS,
  DAILY_REPORT_UNUSUAL_MIN_CENTS,
  DAILY_REPORT_UNUSUAL_MULTIPLE,
  DAILY_REPORT_USUAL_DAYS,
  DAILY_REPORT_USUAL_MIN_DAYS,
} from "@/config/daily-report";
import { addDays, median } from "@/detection/units";
import { kindOf, spendingLines, type InsightTransaction } from "@/insights/spending";

// One day's spending for the daily report, from the same lines the insights page lists
// (spendingLines: pending, transfers and card payments aren't spending), so a day's total is the
// sum of its lines to the cent. Pure.

export type SpendingDay = {
  day: string;
  // Spending net of refunds, as the insights page counts it.
  totalCents: number;
  // Charges that day (refunds aren't purchases).
  purchases: number;
  // The biggest few by merchant, biggest first.
  largest: { merchant: string; cents: number }[];
  // Charges the bank has not settled: left out of the total, as the pages leave them out.
  pending: number;
  // The middle of the days with spending in the weeks before, when there are enough of them.
  usualCents: number | null;
  // Well above a usual day (DAILY_REPORT_UNUSUAL_MULTIPLE and DAILY_REPORT_UNUSUAL_MIN_CENTS).
  unusual: boolean;
};

// The biggest few charges, a merchant's together, biggest first.
function largestByMerchant(lines: readonly { merchant: string; cents: number }[]) {
  const byMerchant = new Map<string, number>();
  for (const line of lines) {
    byMerchant.set(line.merchant, (byMerchant.get(line.merchant) ?? 0) + line.cents);
  }
  return [...byMerchant]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, DAILY_REPORT_LARGEST)
    .map(([merchant, cents]) => ({ merchant, cents }));
}

// Lines the bank posted after the last report with a date before `yesterday` (it posts a day or two
// late), as spending the report didn't have. `arrived` is the ids of the lines that came in after the
// last report and no later than this run (so the next report starts where this one stops: no line is
// in two). Only a recent date counts (DAILY_REPORT_LATE_DAYS), and pending lines don't (kindOf).
export type PostedSince = {
  count: number;
  totalCents: number;
  largest: { merchant: string; cents: number }[];
};

export function postedSince(
  transactions: readonly InsightTransaction[],
  arrived: ReadonlySet<string>,
  yesterday: string,
): PostedSince {
  const from = addDays(yesterday, -DAILY_REPORT_LATE_DAYS);
  const lines = spendingLines(
    transactions.filter((t) => t.id && arrived.has(t.id) && t.date >= from && t.date < yesterday),
    { asOf: yesterday, monthCount: DAILY_REPORT_MONTHS },
  );
  return {
    count: lines.filter((l) => l.cents > 0).length,
    totalCents: lines.reduce((sum, l) => sum + l.cents, 0),
    largest: largestByMerchant(lines),
  };
}

export function spendingDay(transactions: InsightTransaction[], day: string): SpendingDay {
  const lines = spendingLines(transactions, { asOf: day, monthCount: DAILY_REPORT_MONTHS });
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.date, (totals.get(line.date) ?? 0) + line.cents);

  const today = lines.filter((l) => l.date === day);
  const largest = largestByMerchant(today);

  const from = addDays(day, -DAILY_REPORT_USUAL_DAYS);
  const before = [...totals]
    .filter(([date, cents]) => date >= from && date < day && cents > 0)
    .map(([, cents]) => cents);
  const usualCents =
    before.length >= DAILY_REPORT_USUAL_MIN_DAYS ? Math.round(median(before)) : null;
  const totalCents = totals.get(day) ?? 0;

  return {
    day,
    totalCents,
    purchases: today.filter((l) => l.cents > 0).length,
    largest,
    // Only a charge that would be spending once settled: a pending transfer out or card payment never is.
    pending: transactions.filter(
      (t) =>
        t.date === day &&
        t.pending &&
        t.amountCents > 0 &&
        kindOf({ ...t, pending: false }) === "spending",
    ).length,
    usualCents,
    unusual:
      usualCents !== null &&
      totalCents >= usualCents * DAILY_REPORT_UNUSUAL_MULTIPLE &&
      totalCents - usualCents >= DAILY_REPORT_UNUSUAL_MIN_CENTS,
  };
}
