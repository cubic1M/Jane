import { describe, expect, it } from "vitest";
import { checkInData, previousMonth } from "./check-in";
import { spendingInsights, type InsightTransaction } from "./spending";

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
  tx("2026-08-10", 30_000, "FOOD_AND_DRINK"),
  tx("2026-09-10", 25_000, "FOOD_AND_DRINK"),
  tx("2026-09-12", 9_000, "ENTERTAINMENT"),
  tx("2026-09-15", -300_000, "INCOME"),
  tx("2026-10-01", 99_999, "FOOD_AND_DRINK"),
];

describe("checkInData", () => {
  const data = checkInData(
    transactions,
    [
      { category: "Food and drink", amountCents: 20_000 },
      { category: "Entertainment", amountCents: 10_000 },
    ],
    "2026-09",
  );

  it("matches insights for the month and the month before", () => {
    const insights = spendingInsights(transactions, { asOf: "2026-09-30", monthCount: 2 });
    expect(data.spendingCents).toBe(insights.months[1].spendingCents);
    expect(data.previousSpendingCents).toBe(insights.months[0].spendingCents);
    expect(data).toMatchObject({
      month: "2026-09",
      spendingCents: 34_000,
      previousSpendingCents: 30_000,
      incomeCents: 300_000,
    });
  });

  it("says which budgets were kept that month", () => {
    expect(data.budgets).toEqual([
      { category: "Entertainment", budgetCents: 10_000, spentCents: 9_000, kept: true },
      { category: "Food and drink", budgetCents: 20_000, spentCents: 25_000, kept: false },
    ]);
  });

  it("counts payments toward cards and loans that month (spec step 148)", () => {
    const withPayments = [
      ...transactions,
      tx("2026-09-25", 85_000, "LOAN_PAYMENTS"),
      // The card's side of the same payment, and last month's.
      tx("2026-09-26", -85_000, "LOAN_PAYMENTS"),
      tx("2026-08-25", 85_000, "LOAN_PAYMENTS"),
    ];
    expect(checkInData(withPayments, [], "2026-09").debtPaymentsCents).toBe(85_000);
    expect(data.debtPaymentsCents).toBe(0);
  });

  it("finds the month before, across a year", () => {
    expect(previousMonth("2026-10-03")).toBe("2026-09");
    expect(previousMonth("2027-01-01")).toBe("2026-12");
  });
});
