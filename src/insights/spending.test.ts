import { describe, expect, it } from "vitest";
import { kindOf, monthsEnding, spendingInsights, type InsightTransaction } from "./spending";
import { typicalMonthlySpending } from "./typical-month";

const t = (overrides: Partial<InsightTransaction>): InsightTransaction => ({
  date: "2026-10-05",
  amountCents: 1000,
  description: "SHOP",
  merchantName: null,
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  pending: false,
  ...overrides,
});

const run = (rows: InsightTransaction[]) =>
  spendingInsights(rows, { asOf: "2026-10-18", monthCount: 3 });

describe("spendingInsights", () => {
  it("covers the last months, oldest first", () => {
    expect(monthsEnding("2026-01-31", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(run([]).months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("reconciles exactly with the transactions it counts", () => {
    const rows = [
      t({ amountCents: 1234 }),
      t({
        amountCents: 5000,
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        merchantName: "Grocer",
      }),
      t({
        amountCents: 199,
        date: "2026-09-30",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_ATM_FEES",
      }),
      t({ amountCents: -250000, pfcPrimary: "INCOME", pfcDetailed: "INCOME_SALARY" }),
    ];
    const insights = run(rows);
    const october = insights.months.find((m) => m.month === "2026-10")!;
    const september = insights.months.find((m) => m.month === "2026-09")!;

    expect(october).toEqual({ month: "2026-10", spendingCents: 6234, incomeCents: 250000 });
    expect(september.spendingCents).toBe(199);
    const categoryTotal = insights.categoriesByMonth["2026-10"].reduce(
      (sum, c) => sum + c.cents,
      0,
    );
    expect(categoryTotal).toBe(october.spendingCents);
  });

  it("doesn't count card payments, transfers or pending charges", () => {
    const rows = [
      t({
        amountCents: 80000,
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      }),
      t({
        amountCents: -80000,
        pfcPrimary: "TRANSFER_IN",
        pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      }),
      t({
        amountCents: 30000,
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      }),
      t({ amountCents: 999, pending: true }),
    ];

    expect(rows.map(kindOf)).toEqual(["ignored", "ignored", "ignored", "ignored"]);
    expect(run(rows).months.every((m) => m.spendingCents === 0 && m.incomeCents === 0)).toBe(true);
  });

  it("nets refunds against their category", () => {
    const insights = run([
      t({ amountCents: 5000 }),
      t({ amountCents: -2000, description: "RETURN" }),
    ]);

    expect(insights.categoriesByMonth["2026-10"]).toEqual([{ category: "Shopping", cents: 3000 }]);
  });

  it("ranks merchants and shows the biggest month-over-month changes", () => {
    const insights = run([
      t({ merchantName: "Grocer", amountCents: 9000, pfcPrimary: "FOOD_AND_DRINK" }),
      t({
        merchantName: "Grocer",
        amountCents: 1000,
        date: "2026-09-10",
        pfcPrimary: "FOOD_AND_DRINK",
      }),
      t({ merchantName: "Shop", amountCents: 3000 }),
      t({ merchantName: "Shop", amountCents: 3000, date: "2026-09-10" }),
    ]);

    expect(insights.topMerchants.map((m) => [m.merchant, m.cents, m.count])).toEqual([
      ["Grocer", 10000, 2],
      ["Shop", 6000, 2],
    ]);
    expect(insights.changes).toEqual([
      { category: "Food and drink", beforeCents: 1000, afterCents: 9000, changeCents: 8000 },
    ]);
  });

  it("labels uncategorized spending", () => {
    expect(
      run([t({ pfcPrimary: null, pfcDetailed: null })]).categoriesByMonth["2026-10"][0].category,
    ).toBe("Uncategorized");
  });
});

describe("typicalMonthlySpending", () => {
  it("averages the complete months before this one, leaving this month out", () => {
    const rows = [
      t({ date: "2026-08-02", amountCents: 30_000 }),
      t({ date: "2026-09-10", amountCents: 50_000 }),
      // This month is still going: left out.
      t({ date: "2026-10-05", amountCents: 999_000 }),
    ];
    expect(typicalMonthlySpending(rows, "2026-10-18", 2)).toBe(40_000);
    expect(typicalMonthlySpending([], "2026-10-18", 2)).toBe(0);
  });

  it("leaves out a month the data starts partway through", () => {
    // Night QA 10-30: statements from Jul 28 made July a month of four days, and the emergency
    // fund goal "3 months of your own average spending" came out about a third low.
    const rows = [
      t({ date: "2026-07-28", amountCents: 5_000 }),
      t({ date: "2026-08-10", amountCents: 300_000 }),
      t({ date: "2026-09-10", amountCents: 340_000 }),
    ];
    expect(typicalMonthlySpending(rows, "2026-10-18", 3)).toBe(320_000);
    // Only partial months: nothing to average yet.
    expect(typicalMonthlySpending(rows.slice(0, 1), "2026-08-18", 1)).toBe(0);
  });
});
