import { spendingInsights, type InsightTransaction, type MonthTotals } from "./spending";

// The year in review: spending by month and category for one calendar year, compared
// with the year before. Built from spendingInsights, so every total is the one /insights
// shows for the same months. Pure.

export type YearReview = {
  year: number;
  // The year's months up to asOf.
  months: MonthTotals[];
  spendingCents: number;
  incomeCents: number;
  categories: { category: string; cents: number }[];
  // Biggest changes in a category from the year before, largest first.
  changes: {
    category: string;
    lastYearCents: number;
    thisYearCents: number;
    changeCents: number;
  }[];
};

const TOP_CHANGES = 5;

function yearTotals(transactions: InsightTransaction[], year: number, asOf: string) {
  const end = `${year}-12-31` < asOf ? `${year}-12-31` : asOf;
  const months = Number(end.slice(5, 7));
  const insights = spendingInsights(transactions, { asOf: end, monthCount: months });
  const categories = new Map<string, number>();
  for (const month of insights.months) {
    for (const c of insights.categoriesByMonth[month.month] ?? []) {
      categories.set(c.category, (categories.get(c.category) ?? 0) + c.cents);
    }
  }
  return { months: insights.months, categories };
}

export function yearReview(
  transactions: InsightTransaction[],
  year: number,
  asOf: string,
): YearReview {
  const thisYear = yearTotals(transactions, year, asOf);
  const lastYear = yearTotals(transactions, year - 1, asOf);
  const categories = [...thisYear.categories]
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  const changes = [...new Set([...thisYear.categories.keys(), ...lastYear.categories.keys()])]
    .map((category) => {
      const thisYearCents = thisYear.categories.get(category) ?? 0;
      const lastYearCents = lastYear.categories.get(category) ?? 0;
      return { category, lastYearCents, thisYearCents, changeCents: thisYearCents - lastYearCents };
    })
    .filter((c) => c.changeCents !== 0 && c.lastYearCents > 0)
    .sort(
      (a, b) =>
        Math.abs(b.changeCents) - Math.abs(a.changeCents) || a.category.localeCompare(b.category),
    )
    .slice(0, TOP_CHANGES);
  return {
    year,
    months: thisYear.months,
    spendingCents: thisYear.months.reduce((sum, m) => sum + m.spendingCents, 0),
    incomeCents: thisYear.months.reduce((sum, m) => sum + m.incomeCents, 0),
    categories,
    changes,
  };
}
