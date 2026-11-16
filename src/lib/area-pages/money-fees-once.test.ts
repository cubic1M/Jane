import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2 (11-15, a student with 14 months of Wells Fargo checking and a Capital One card, 1280
// light): Spending & bills, "Charges to look at" listed "Bank fees you can stop $139/yr" (7 fees)
// and "Late fees to stop $29/yr", and the $139 already held that $29 late fee: $168 on the page
// for $139 of fees (the report: $139, the dock: $139). Suggestions that touch the same money
// (MONEY_GROUPS) are listed once, the best of them, as the dock offers them.

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
    debt: { accounts: 0, owedCents: 0 },
  },
  rules: 0,
};

const fees = { id: "s-fees", topic: "bank_fees", urgency: "soon", worthKind: "saves" };
const input: MoneyTreeInput = {
  ...base,
  // Best first, as the page loads them.
  suggestions: [
    { ...fees, summary: "You paid $139.00 in 7 bank fees in a year.", worthCents: 13_900 },
    {
      ...fees,
      id: "s-late",
      topic: "late_fees",
      summary: "You paid $29.00 in 1 late fees.",
      worthCents: 2_900,
    },
    {
      ...fees,
      id: "s-subs",
      topic: "subscriptions",
      summary: "You pay about $713.76 a year.",
      worthCents: 17_800,
    },
  ],
};

const charges = (tree: ReturnType<typeof moneyTree>["tree"]) =>
  tree.branches.find((b) => b.id === "charges")?.items.map((i) => i.id) ?? [];

describe("fees counted once on Spending & bills", () => {
  it("lists the late fees inside the bank fees once, under the bank fees", () => {
    expect(charges(moneyTree(input).tree)).toEqual(["charges:bank_fees"]);
  });

  it("keeps the late fees when nothing else holds them", () => {
    const alone = { ...input, suggestions: input.suggestions.slice(1) };
    expect(charges(moneyTree(alone).tree)).toEqual(["charges:late_fees"]);
  });
});
