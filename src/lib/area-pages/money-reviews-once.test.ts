import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debugger 11-20 (r370, Plaid S2 sandbox on a phone; r357 before it): Spending & bills →
// Subscriptions listed "Subscriptions to review $169/yr" and, under it, "Crunch Fitness $360/yr"
// and "Apple $132/yr", the reviews that suggestion is made of: the same money twice, in one column.
// Each one is said once, by name; the combined suggestion only stands alone. (Not the other way:
// the dock posts either the combined card or each review, as the day's cards rank them.)

const recurring = (merchant: string, cents: number) => ({
  key: `merchant:${merchant.toLowerCase()}`,
  merchant,
  lastAmountCents: cents,
  frequency: "monthly",
  nextDate: "2026-12-03",
  annualCostCents: cents * 12,
  subscription: true,
  findingId: `f-${merchant}`,
});

const base: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [recurring("Crunch Fitness", 2_999), recurring("Apple", 1_099)],
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

const together = {
  id: "s-subs",
  topic: "subscriptions",
  summary: "You pay about $677.64 a year across 3 subscriptions.",
  headline: "Cancel subscriptions you don't use, save $169 a year",
  worthCents: 16_900,
  worthKind: "saves",
  urgency: "soon",
};

const subscriptions = (i: MoneyTreeInput) =>
  moneyTree(i)
    .tree.branches.find((b) => b.id === "subscriptions")
    ?.items.map((x) => x.label) ?? [];

describe("subscriptions reviewed together on Spending & bills", () => {
  it("are said once, each by name, not again as the suggestion that sums them", () => {
    expect(subscriptions({ ...base, suggestions: [together] })).toEqual([
      "Crunch Fitness",
      "Apple",
      "All your regular charges",
    ]);
  });

  it("keep the suggestion when there are no reviews by name to say it", () => {
    const quiet = base.recurring.map((r) => ({ ...r, findingId: null }));
    expect(subscriptions({ ...base, recurring: quiet, suggestions: [together] })).toEqual([
      "Subscriptions to review",
      "All your regular charges",
    ]);
  });
});
