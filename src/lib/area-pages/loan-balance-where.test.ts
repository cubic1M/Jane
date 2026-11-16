import { describe, expect, it } from "vitest";
import { loansIntro } from "./loans";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debugger 11-16 (a Chase checking upload on a phone, paying Nelnet and Toyota Motor Credit): Loans
// said "Your files don't say what you owe yet. Add a balance on the import page.", but the import
// page only takes a balance for an uploaded account. A loan Jane sees only in payments takes its
// balance on its own card ("Add what your bank doesn't report", "Left to pay"). An uploaded card
// with no balance still goes to the import page.

const seen = (key: string) => ({ key, balanceCents: null, inNetWorth: true });
const book = (debts: ReturnType<typeof seen>[]) => ({ debts, totalOwedCents: 0, monthlyCents: 0 });

describe("where to add what's owed", () => {
  it("is the loan's own card for loans seen only in payments", () => {
    const intro = loansIntro(
      book([seen("paid:student:nelnet student loan"), seen("paid:auto:toyota motor credit")]),
    );
    expect(intro).not.toContain("import page");
    expect(intro).toBe(
      "Jane sees your loan payments, not what you owe. Open a loan below to add what's left.",
    );
  });

  it("is still the import page for an uploaded card with no balance", () => {
    expect(loansIntro(book([seen("account:a1")]))).toContain("Add a balance on the import page.");
  });

  it("Spending's Loans and cards line points to Loans, not the import page", () => {
    const base: MoneyTreeInput = {
      hasAccounts: true,
      cushionCents: 10_000,
      suggestions: [],
      lows: [],
      bills: [],
      weekEnds: "2026-11-22",
      recurring: [],
      budgets: { daysLeft: 15, progress: [] },
      yearly: [],
      spending: null,
      books: [],
      transfers: [],
      have: {
        netCents: 0,
        assetsCents: 0,
        debtsCents: 0,
        investmentsCents: 0,
        ownedCents: 0,
        owned: 0,
        assetPrompt: null,
        goals: { total: 0, onTrack: 0 },
        debt: { accounts: 0, others: 2, owedCents: 0, known: 0 },
      },
      rules: 0,
    };
    expect(moneyTree(base).summaries["have:loans"]).toBe(
      "Jane sees your loan payments, not what you owe. Add it on Loans and credit.",
    );
  });
});
