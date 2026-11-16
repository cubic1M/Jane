import { describe, expect, it, vi } from "vitest";

vi.mock("./llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { categorizeTransactions } from "./categorize";
import type { NormalizedTransaction } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";
import { spendingInsights } from "@/insights/spending";

// Debugger 11-16 (a student linked through Plaid sandbox): Plaid filed the weekly "Sweetgreen inc
// payroll ppd id" deposit under restaurants, so $810 of pay a week netted against spending as a
// refund. The money health score then read about 12 cents a month of income ("card balances of
// $500.00, about 4166.7 months of income") and 100% of pay left after spending.

const db = {
  userId: "user_1",
  merchantCategories: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
} as unknown as Pick<ScopedDb, "userId" | "merchantCategories">;

const txn = (
  description: string,
  amountCents: number,
  categoryDetailed: string,
  date = "2026-10-09",
): NormalizedTransaction => ({
  accountRef: "acct_1",
  date,
  amountCents,
  description,
  merchantName: null,
  categoryPrimary: null,
  categoryDetailed,
  pending: false,
  externalId: `${description}-${date}-${amountCents}`,
  hints: {},
});

describe("pay a bank filed under something bought", () => {
  it("is pay, not a refund", async () => {
    const [pay] = await categorizeTransactions(
      [txn("Sweetgreen inc payroll ppd id", -81_000, "FOOD_AND_DRINK_RESTAURANT")],
      db,
    );
    expect(pay.category?.primary).toBe("INCOME");
  });

  it("counts as income in the month's totals", async () => {
    const rows = await categorizeTransactions(
      [
        txn("Sweetgreen inc payroll ppd id", -81_000, "FOOD_AND_DRINK_RESTAURANT", "2026-10-02"),
        txn("Sweetgreen inc payroll ppd id", -81_000, "FOOD_AND_DRINK_RESTAURANT", "2026-10-09"),
        txn("Trader Joes", 6_400, "FOOD_AND_DRINK_GROCERIES", "2026-10-05"),
      ],
      db,
    );
    const [october] = spendingInsights(
      rows.map((r) => ({
        ...r,
        pfcPrimary: r.category?.primary ?? null,
        pfcDetailed: r.category?.detailed ?? null,
      })),
      { asOf: "2026-10-31", monthCount: 1 },
    ).months;
    expect(october).toMatchObject({ incomeCents: 162_000, spendingCents: 6_400 });
  });

  it("leaves a refund, and money filed as a transfer, as filed", async () => {
    const [refund, transfer] = await categorizeTransactions(
      [
        txn("Sweetgreen refund", -1_450, "FOOD_AND_DRINK_RESTAURANT"),
        txn("GUSTO PAYROLL", -5_000, "TRANSFER_IN_ACCOUNT_TRANSFER"),
      ],
      db,
    );
    expect(refund.category?.detailed).toBe("FOOD_AND_DRINK_RESTAURANT");
    expect(transfer.category?.detailed).toBe("TRANSFER_IN_ACCOUNT_TRANSFER");
  });
});
