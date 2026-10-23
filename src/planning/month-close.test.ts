import { describe, expect, it } from "vitest";
import { UNCERTAIN_MAX } from "@/config/month-close";
import { categoryWords, monthFigures, uncertainOf, type CloseTx } from "./month-close";

// Spec step 244, pure: the charges Jane isn't sure of, and what the month came to.

const tx = (over: Partial<CloseTx>): CloseTx => ({
  id: over.id ?? "t",
  date: "2026-09-10",
  amountCents: 5_000,
  description: "SHOP",
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
  categorySource: "plaid",
  ...over,
});
const OTHER = "GENERAL_SERVICES_OTHER_GENERAL_SERVICES";

describe("the monthly close", () => {
  it("asks only about catch-all charges of $20 or more the person hasn't set, biggest first", () => {
    const unsure = uncertainOf(
      [
        tx({ id: "a", pfcDetailed: OTHER, amountCents: 28_500 }),
        tx({ id: "b", pfcDetailed: null, amountCents: 6_000 }),
        tx({ id: "c", pfcDetailed: OTHER, amountCents: 1_999 }),
        tx({ id: "d", pfcDetailed: OTHER, categorySource: "user" }),
        tx({ id: "e", pfcDetailed: OTHER, date: "2026-08-30" }),
        tx({ id: "f" }),
      ],
      "2026-09",
    );
    expect(unsure.map((t) => t.id)).toEqual(["a", "b"]);
    const many = Array.from({ length: 9 }, (_, i) => tx({ id: `m${i}`, pfcDetailed: OTHER }));
    expect(uncertainOf(many, "2026-09")).toHaveLength(UNCERTAIN_MAX);
  });

  it("counts what came in and went out, without transfers or card payments", () => {
    const f = monthFigures(
      [
        tx({
          id: "pay",
          amountCents: -300_000,
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_SALARY",
        }),
        tx({ id: "food", amountCents: 20_000, pfcPrimary: "FOOD_AND_DRINK" }),
        tx({ id: "rent", amountCents: 150_000, pfcPrimary: "RENT_AND_UTILITIES" }),
        tx({ id: "move", amountCents: 50_000, pfcPrimary: "TRANSFER_OUT" }),
        tx({
          id: "card",
          amountCents: 40_000,
          pfcPrimary: "LOAN_PAYMENTS",
          pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        }),
        tx({ id: "aug", date: "2026-08-31", amountCents: 99_999 }),
      ],
      "2026-09",
    );
    expect(f).toEqual({
      month: "2026-09",
      incomeCents: 300_000,
      spendingCents: 170_000,
      topCategories: [
        { category: "RENT_AND_UTILITIES", cents: 150_000 },
        { category: "FOOD_AND_DRINK", cents: 20_000 },
      ],
    });
    expect(categoryWords("RENT_AND_UTILITIES")).toBe("Rent and utilities");
  });
});
