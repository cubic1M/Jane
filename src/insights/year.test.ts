import { describe, expect, it } from "vitest";
import { spendingInsights, type InsightTransaction } from "./spending";
import { yearReview } from "./year";

const tx = (date: string, amountCents: number, pfcPrimary: string): InsightTransaction => ({
  date,
  amountCents,
  description: "SHOP",
  merchantName: null,
  pfcPrimary,
  pfcDetailed: null,
  pending: false,
});

const transactions = [
  tx("2025-03-10", 40_000, "FOOD_AND_DRINK"),
  tx("2025-11-10", 20_000, "TRAVEL"),
  tx("2026-01-05", 45_000, "FOOD_AND_DRINK"),
  tx("2026-02-05", 15_000, "FOOD_AND_DRINK"),
  tx("2026-02-06", 9_000, "ENTERTAINMENT"),
  tx("2026-02-07", -300_000, "INCOME"),
  tx("2026-03-01", 70_000, "TRANSFER_OUT"),
  tx("2026-10-02", 5_000, "ENTERTAINMENT"),
];

describe("yearReview", () => {
  const review = yearReview(transactions, 2026, "2026-10-20");

  it("matches insights month by month for the year so far", () => {
    const insights = spendingInsights(transactions, { asOf: "2026-10-20", monthCount: 10 });
    expect(review.months).toEqual(insights.months);
    expect(review.spendingCents).toBe(74_000);
    expect(review.incomeCents).toBe(300_000);
  });

  it("totals categories for the year, largest first", () => {
    expect(review.categories).toEqual([
      { category: "Food and drink", cents: 60_000 },
      { category: "Entertainment", cents: 14_000 },
    ]);
  });

  it("compares with last year where there's something to compare", () => {
    // Equal changes are ordered by name.
    expect(review.changes).toEqual([
      {
        category: "Food and drink",
        lastYearCents: 40_000,
        thisYearCents: 60_000,
        changeCents: 20_000,
      },
      { category: "Travel", lastYearCents: 20_000, thisYearCents: 0, changeCents: -20_000 },
    ]);
  });

  it("covers all twelve months of a past year", () => {
    const past = yearReview(transactions, 2025, "2026-10-20");
    expect(past.months.map((m) => m.month)).toHaveLength(12);
    expect(past.spendingCents).toBe(60_000);
  });
});
