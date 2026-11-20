import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Class 7 in a list (debug 3, 11-20): Spending & bills → Coming up read "Bills this week $274 · 4
// bills" above "The next month of bills $2.8k · 16 bills" for every sweep person with bills this
// week, and those four were in both figures. Beside this week's line, the month's is what comes
// after it, so each bill is in one line's figure and the two add up to the month.

const input: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [
    { merchant: "Spotify", date: "2026-11-21", amountCents: 1_199 },
    { merchant: "Avalon Rent", date: "2026-12-01", amountCents: 160_000 },
    { merchant: "Verizon", date: "2026-12-10", amountCents: 6_500 },
  ],
  weekEnds: "2026-11-26",
  recurring: [],
  budgets: { daysLeft: 10, progress: [] },
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

const coming = (i: MoneyTreeInput) => {
  const { tree, summaries } = moneyTree(i);
  return (tree.branches.find((b) => b.id === "coming")?.items ?? [])
    .filter((x) => x.id === "coming:week" || x.id === "coming:month")
    .map((x) => [x.label, x.line, x.figure, summaries[x.id]]);
};

describe("bills coming up on Spending & bills", () => {
  it("count each bill once: this week's, then what comes after", () => {
    expect(coming(input)).toEqual([
      [
        "Bills this week",
        "1 bill",
        "$12",
        "1 regular charge expected in the next 7 days, about $11.99 in all.",
      ],
      [
        "After this week",
        "2 bills",
        "$1.7k",
        "2 regular charges expected over the rest of the next month, about $1,665.00 in all.",
      ],
    ]);
  });

  it("say the next month whole when nothing is due this week", () => {
    const later = { ...input, bills: input.bills.slice(1) };
    expect(coming(later)).toEqual([
      [
        "The next month of bills",
        "2 bills",
        "$1.7k",
        "2 regular charges expected over the next month, about $1,665.00 in all.",
      ],
    ]);
  });
});
