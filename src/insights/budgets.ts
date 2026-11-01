import {
  BUDGET_FIXED_PRIMARIES,
  BUDGET_SUGGESTION_MONTHS,
  BUDGET_SUGGESTION_ROUNDING_CENTS,
} from "@/config/budgets";
import { OVER_BUDGET_CONFIDENCE } from "@/config/detection";
import { formatCents } from "@/lib/money";
import { CATEGORY_LABELS } from "./labels";
import { monthsEnding, spendingInsights, type InsightTransaction } from "./spending";
import { fullMonths, oneOffCharges, withoutOneOffs } from "./typical-month";

// Budgets against this month's spending. Spending comes from spendingInsights, so a
// category's total here is exactly the one on /insights (same rules for transfers, card
// payments and refunds). Pure.

export type Budget = { category: string; amountCents: number };

export type BudgetProgress = {
  category: string;
  budgetCents: number;
  spentCents: number;
  leftCents: number;
  over: boolean;
};

export type BudgetSummary = {
  month: string;
  daysLeft: number;
  progress: BudgetProgress[];
  // Average monthly spending per category over the last complete months, rounded up:
  // the starting point offered when setting a budget. Not a recommendation.
  suggestions: Record<string, number>;
  // Every category with spending this month or in the suggestion window.
  categories: string[];
};

function daysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

export function budgetSummary(
  transactions: InsightTransaction[],
  budgets: Budget[],
  asOf: string,
): BudgetSummary {
  const months = monthsEnding(asOf, BUDGET_SUGGESTION_MONTHS + 1);
  const insights = spendingInsights(transactions, { asOf, monthCount: months.length });
  const month = months.at(-1)!;
  const spentIn = (m: string, category: string) =>
    insights.categoriesByMonth[m]?.find((c) => c.category === category)?.cents ?? 0;

  // Only months the data covers in full: a month it starts partway through isn't "your own
  // average" (src/insights/typical-month.ts).
  const past = fullMonths(months.slice(0, -1), transactions);
  // Suggestions start from a typical month: one-off costs (books QA) would make a budget of them.
  const typical = spendingInsights(
    withoutOneOffs(transactions, oneOffCharges(transactions, asOf)),
    { asOf, monthCount: months.length },
  );
  const typicalIn = (m: string, category: string) =>
    typical.categoriesByMonth[m]?.find((c) => c.category === category)?.cents ?? 0;
  const categories = [
    ...new Set(months.flatMap((m) => (insights.categoriesByMonth[m] ?? []).map((c) => c.category))),
  ].sort();
  const fixed = new Set(BUDGET_FIXED_PRIMARIES.map((p) => CATEGORY_LABELS[p] ?? p));
  const suggestions = Object.fromEntries(
    categories
      .filter((category) => !fixed.has(category))
      .map((category) => {
        const average =
          past.length === 0
            ? 0
            : past.reduce((sum, m) => sum + typicalIn(m, category), 0) / past.length;
        const rounded =
          Math.ceil(average / BUDGET_SUGGESTION_ROUNDING_CENTS) * BUDGET_SUGGESTION_ROUNDING_CENTS;
        return [category, rounded];
      }),
  );

  return {
    month,
    daysLeft: daysInMonth(month) - Number(asOf.slice(8, 10)),
    progress: budgets
      .map((b) => {
        const spent = spentIn(month, b.category);
        return {
          category: b.category,
          budgetCents: b.amountCents,
          spentCents: spent,
          leftCents: b.amountCents - spent,
          over: spent > b.amountCents,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category)),
    suggestions,
    categories,
  };
}

export type BudgetAlert = {
  type: "over_budget";
  key: string;
  title: string;
  body: string;
  confidence: { percent: number; reason: string };
};

// "11 days left this month."; on the last day, said as such rather than "0 days left".
export function daysLeftWords(daysLeft: number): string {
  return daysLeft === 0
    ? "Today is the last day of the month."
    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month.`;
}

// One alert per category per month, the first time spending passes the budget. The key
// names the month, so later scans that month raise nothing new.
export function overBudgetAlerts(summary: BudgetSummary): BudgetAlert[] {
  return summary.progress
    .filter((p) => p.over)
    .map((p) => ({
      type: "over_budget",
      key: `${p.category}:${summary.month}`,
      title: `${p.category} is over budget this month`,
      body: `You've spent ${formatCents(p.spentCents)} of your ${formatCents(p.budgetCents)} budget, ${summary.daysLeft === 0 ? "on the month's last day" : `with ${summary.daysLeft} day${summary.daysLeft === 1 ? "" : "s"} left in the month`}.`,
      confidence: { ...OVER_BUDGET_CONFIDENCE },
    }));
}
