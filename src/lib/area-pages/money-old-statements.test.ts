import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 3's invariants (11-19, the "now from old statements" class): a statement that ended Sep 11,
// read on Nov 12. Spending said "$8,450.00 today. Nothing coming up takes it lower." and "You have
// $8,450.00 and owe $0.00." as if both were today's, while the chat's net worth said "That's from
// your statements, which end on Sep 11". No lowest point ahead from a balance that old, and net
// worth says where its figure is from.

const base = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [
    {
      accountId: "a1",
      name: "Checking",
      startCents: 845_000,
      lowCents: 845_000,
      date: "2026-11-12",
    },
  ],
  bills: [],
  weekEnds: "2026-11-19",
  recurring: [],
  budgets: { daysLeft: 18, progress: [] },
  yearly: [],
  spending: null,
  books: [],
  transfers: [],
  have: {
    netCents: 845_000,
    assetsCents: 845_000,
    debtsCents: 0,
    investmentsCents: 0,
    ownedCents: 0,
    owned: 0,
    assetPrompt: null,
    goals: { total: 0, onTrack: 0 },
    debt: { accounts: 1, owedCents: 0 },
  },
  rules: 0,
} as MoneyTreeInput;
const old = { ...base, statementsEnd: "2026-09-11" } as MoneyTreeInput;

describe("Spending, from statements that ended long ago", () => {
  it("draws no lowest balance ahead", () => {
    expect(moneyTree(base).summaries["coming:low-a1"]).toBeDefined();
    expect(moneyTree(old).summaries["coming:low-a1"]).toBeUndefined();
  });

  it("says where net worth's figure is from", () => {
    expect(moneyTree(base).summaries["have:net-worth"]).toBe("You have $8,450.00 and owe $0.00.");
    expect(moneyTree(old).summaries["have:net-worth"]).toBe(
      "You have $8,450.00 and owe $0.00. That's from your statements, which end on Sep 11.",
    );
  });
});
