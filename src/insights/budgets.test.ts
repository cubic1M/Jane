import { OVER_BUDGET_CONFIDENCE } from "@/config/detection";
import { describe, expect, it } from "vitest";
import { budgetSummary, overBudgetAlerts } from "./budgets";
import { spendingInsights, type InsightTransaction } from "./spending";

const ASOF = "2026-10-20";
const tx = (
  date: string,
  amountCents: number,
  pfcPrimary: string | null,
  extra = {},
): InsightTransaction => ({
  date,
  amountCents,
  description: "SHOP",
  merchantName: null,
  pfcPrimary,
  pfcDetailed: null,
  pending: false,
  ...extra,
});

const transactions = [
  // Three complete months of food: $300, $360, $330 (average $330).
  tx("2026-07-05", 30_000, "FOOD_AND_DRINK"),
  tx("2026-08-05", 36_000, "FOOD_AND_DRINK"),
  tx("2026-09-05", 33_000, "FOOD_AND_DRINK"),
  // This month: $250 spent, a $20 refund, a card payment and a transfer that don't count.
  tx("2026-10-03", 25_000, "FOOD_AND_DRINK"),
  tx("2026-10-04", -2_000, "FOOD_AND_DRINK"),
  tx("2026-10-05", 50_000, "LOAN_PAYMENTS", { pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
  tx("2026-10-06", 80_000, "TRANSFER_OUT"),
  tx("2026-10-07", 9_999, "FOOD_AND_DRINK", { pending: true }),
  tx("2026-10-08", 12_000, "ENTERTAINMENT"),
];

describe("budgetSummary", () => {
  const budgets = [
    { category: "Food and drink", amountCents: 20_000 },
    { category: "Entertainment", amountCents: 15_000 },
  ];
  const summary = budgetSummary(transactions, budgets, ASOF);

  it("counts spending exactly as insights does", () => {
    const insights = spendingInsights(transactions, { asOf: ASOF, monthCount: 12 });
    for (const p of summary.progress) {
      const onInsights = insights.categoriesByMonth["2026-10"].find(
        (c) => c.category === p.category,
      );
      expect(p.spentCents, p.category).toBe(onInsights?.cents ?? 0);
    }
  });

  it("shows spent, left and over for this month", () => {
    expect(summary.month).toBe("2026-10");
    expect(summary.daysLeft).toBe(11);
    expect(summary.progress).toEqual([
      {
        category: "Entertainment",
        budgetCents: 15_000,
        spentCents: 12_000,
        leftCents: 3_000,
        over: false,
      },
      {
        category: "Food and drink",
        budgetCents: 20_000,
        spentCents: 23_000,
        leftCents: -3_000,
        over: true,
      },
    ]);
  });

  it("suggests the average of the last three complete months, rounded up to $10", () => {
    expect(summary.suggestions["Food and drink"]).toBe(33_000);
    // Nothing in the three complete months, so nothing to suggest.
    expect(summary.suggestions.Entertainment).toBe(0);
  });

  it("averages only the months the data covers in full", () => {
    // Night QA 10-30: statements from Jul 28 counted four days of July as a month, so the
    // suggested Food and drink budget came out about a third low.
    const late = [
      tx("2026-07-28", 2_000, "FOOD_AND_DRINK"),
      tx("2026-08-05", 36_000, "FOOD_AND_DRINK"),
      tx("2026-09-05", 30_000, "FOOD_AND_DRINK"),
    ];
    expect(budgetSummary(late, [], ASOF).suggestions["Food and drink"]).toBe(33_000);
    // No month covered in full yet: nothing to average.
    expect(budgetSummary(late.slice(0, 1), [], "2026-08-20").suggestions["Food and drink"]).toBe(0);
  });
});

describe("overBudgetAlerts", () => {
  it("alerts once per category per month, and not when under", () => {
    const summary = budgetSummary(
      transactions,
      [
        { category: "Food and drink", amountCents: 20_000 },
        { category: "Entertainment", amountCents: 50_000 },
      ],
      ASOF,
    );
    expect(overBudgetAlerts(summary)).toEqual([
      {
        type: "over_budget",
        key: "Food and drink:2026-10",
        title: "Food and drink is over budget this month",
        body: "You've spent $230.00 of your $200.00 budget, with 11 days left in the month.",
        confidence: OVER_BUDGET_CONFIDENCE,
      },
    ]);
    // Next month the same category gets a new key, so it can alert again.
    const november = budgetSummary(
      [...transactions, tx("2026-11-02", 30_000, "FOOD_AND_DRINK")],
      [{ category: "Food and drink", amountCents: 20_000 }],
      "2026-11-10",
    );
    expect(overBudgetAlerts(november).map((a) => a.key)).toEqual(["Food and drink:2026-11"]);
  });
});

// Spec step 263 (QA sweep): Priya was offered a $5,990 budget for loan payments.
describe("budget suggestions are for flexible spending only", () => {
  const priya = [
    ...["2026-07", "2026-08", "2026-09"].flatMap((m) => [
      tx(`${m}-01`, 599_000, "LOAN_PAYMENTS", { pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" }),
      tx(`${m}-01`, 164_000, "RENT_AND_UTILITIES"),
      tx(`${m}-10`, 200_000, "GENERAL_SERVICES"),
      tx(`${m}-12`, 41_000, "FOOD_AND_DRINK"),
      tx(`${m}-15`, 18_000, "ENTERTAINMENT"),
    ]),
    tx("2026-10-03", 20_000, "FOOD_AND_DRINK"),
  ];
  it("never suggests rent, loan payments or services", () => {
    const { suggestions, categories } = budgetSummary(priya, [], ASOF);
    expect(Object.keys(suggestions).sort()).toEqual(["Entertainment", "Food and drink"]);
    // They're still categories a person can budget by hand.
    expect(categories).toContain("Loan payments");
    expect(categories).toContain("Rent and utilities");
  });
});
