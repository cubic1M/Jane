import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2, fifth desktop sweep (11-17, Plaid sandbox checking sending $500 a month to Fidelity):
// after the person typed their Fidelity balance ($1,560) on the Investments page, Spending & bills
// said "Investments · $1.6k · Retirement and investment accounts, at the balance they report."
// Nothing reported it. The words are true whichever way the balance came in.

const input: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [],
  budgets: { daysLeft: 13, progress: [] },
  yearly: [],
  spending: null,
  books: [],
  transfers: [],
  have: {
    netCents: 464_733,
    assetsCents: 464_733,
    debtsCents: 0,
    investmentsCents: 156_000,
    ownedCents: 0,
    owned: 0,
    assetPrompt: null,
    goals: { total: 0, onTrack: 0 },
    debt: { accounts: 0, owedCents: 0 },
  },
  rules: 0,
};

describe("investments on Spending & bills", () => {
  it("says the latest balance, not one an account reported", () => {
    expect(moneyTree(input).summaries["have:investments"]).toBe(
      "Retirement and investment accounts, at their latest balance.",
    );
  });
});
