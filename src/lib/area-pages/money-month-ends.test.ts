import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2, fourth desktop sweep (11-17, upload S7: a Bank of America statement Jun 1 to Oct 20):
// Spending's "October" read "$1,235.64 spent and $3,000.00 in, in October." for Oct 1 to 20. The
// chat says a month cut short as such (#1975); the tree says it the same way.

const base: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-24",
  recurring: [],
  budgets: { daysLeft: 13, progress: [] },
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
    debt: { accounts: 0, owedCents: 0 },
  },
  rules: 0,
};
const october = (endsOn: string | null) =>
  moneyTree({
    ...base,
    spending: {
      month: "2026-10",
      current: false,
      endsOn,
      spendingCents: 123_564,
      incomeCents: 300_000,
      categories: [{ category: "Rent and utilities", cents: 106_999 }],
      changes: [],
    },
  }).summaries["spending:month"];

describe("Spending's month, cut short by an old statement", () => {
  it("says to when", () => {
    expect(october("2026-10-20")).toBe(
      "$1,235.64 spent and $3,000.00 in, in October (to Oct 20, where what I have ends).",
    );
  });

  it("says nothing more for a month the data covers", () => {
    expect(october(null)).toBe("$1,235.64 spent and $3,000.00 in, in October.");
  });
});
