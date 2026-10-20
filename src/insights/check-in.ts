import { DEBT_PAYMENT_PRIMARY } from "@/config/monthly-report";
import { spendingInsights, type InsightTransaction } from "./spending";

// The monthly check-in's numbers for one month: spending against the month before,
// which budgets were kept, the biggest category changes. Spending comes from
// spendingInsights, so it matches /insights for the same month. Pure.

export type CheckInData = {
  month: string;
  spendingCents: number;
  incomeCents: number;
  // Spec step 148: payments toward cards and loans (money out in LOAN_PAYMENTS).
  debtPaymentsCents: number;
  previousSpendingCents: number;
  budgets: { category: string; budgetCents: number; spentCents: number; kept: boolean }[];
  changes: { category: string; beforeCents: number; afterCents: number; changeCents: number }[];
};

// The calendar month before the one `asOf` falls in.
export function previousMonth(asOf: string): string {
  const [y, m] = asOf.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function checkInData(
  transactions: InsightTransaction[],
  budgets: { category: string; amountCents: number }[],
  month: string,
): CheckInData {
  const insights = spendingInsights(transactions, { asOf: lastDay(month), monthCount: 2 });
  const [before, after] = insights.months;
  const spent = (category: string) =>
    insights.categoriesByMonth[month]?.find((c) => c.category === category)?.cents ?? 0;
  return {
    month,
    spendingCents: after.spendingCents,
    incomeCents: after.incomeCents,
    debtPaymentsCents: transactions
      .filter(
        (t) =>
          !t.pending &&
          t.date.startsWith(month) &&
          t.amountCents > 0 &&
          t.pfcPrimary === DEBT_PAYMENT_PRIMARY,
      )
      .reduce((sum, t) => sum + t.amountCents, 0),
    previousSpendingCents: before.spendingCents,
    budgets: budgets
      .map((b) => ({
        category: b.category,
        budgetCents: b.amountCents,
        spentCents: spent(b.category),
        kept: spent(b.category) <= b.amountCents,
      }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    changes: insights.changes,
  };
}
