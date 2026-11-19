import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debugger 11-19 (r354, Plaid S5 on a phone: one month of a new checking account, $700 of rent by
// Zelle on Nov 1): Spending's "Coming up" had "Lowest balance ahead $860: $860.00 today. Nothing
// coming up takes it lower." while Home's strip said "Too little history to see your bills yet".
// Jane can't see the bills, so it doesn't say none will take the balance lower.

const base: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [
    {
      accountId: "a1",
      name: "Plaid checking",
      startCents: 86_000,
      lowCents: 86_000,
      date: "2026-11-18",
    },
  ],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [],
  budgets: { daysLeft: 12, progress: [] },
  yearly: [],
  spending: null,
  books: [],
  transfers: [],
  have: {
    netCents: 86_000,
    assetsCents: 86_000,
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

const lowest = (input: MoneyTreeInput) =>
  moneyTree(input)
    .tree.branches.flatMap((b) => b.items)
    .find((i) => i.label === "Lowest balance ahead");

describe("the lowest balance ahead on a new account", () => {
  it("isn't claimed while there's too little history to see the bills", () => {
    const input = { ...base, shortHistory: true };
    expect(lowest(input)).toBeUndefined();
    expect(Object.values(moneyTree(input).summaries).join(" ")).not.toContain(
      "Nothing coming up takes it lower",
    );
  });

  it("is still there once the bills can be seen", () => {
    expect(lowest({ ...base, shortHistory: false })).toMatchObject({ figure: "$860" });
  });
});
