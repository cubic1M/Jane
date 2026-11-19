import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debugger 11-19 (r361, upload S2 on a phone: Bank of America checking and a Chase card, Netflix
// $15.49 and Spotify $11.99 a month): Spending & bills → Subscriptions listed "A cheaper plan, same
// service $78/yr" (Netflix's Standard with ads) and "Netflix $186/yr" for one Netflix, two
// figures a student couldn't tell apart. The dock says it once, by the cheaper plan
// (src/lib/jane-agent/sources/findings.ts); the tree does the same.

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

const input: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [
    {
      id: "s-tier",
      topic: "cheaper_tier",
      summary: "Netflix: you pay $15.49, Standard with ads is $8.99.",
      headline: "Note Netflix's Standard with ads plan, save $78 a year",
      worthCents: 7_800,
      worthKind: "saves",
      urgency: "soon",
    },
  ],
  lows: [],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [recurring("Netflix", 1_549), recurring("Spotify", 1_199)],
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

const subscriptions = (i: MoneyTreeInput) =>
  moneyTree(i)
    .tree.branches.find((b) => b.id === "subscriptions")
    ?.items.map((x) => x.label) ?? [];

describe("a service with a cheaper plan on Spending & bills", () => {
  it("is said once, by the cheaper plan", () => {
    expect(subscriptions(input)).toEqual([
      "A cheaper plan, same service",
      "Spotify",
      "All your regular charges",
    ]);
  });

  it("keeps the service's own line when no cheaper plan names it", () => {
    expect(subscriptions({ ...input, suggestions: [] })).toEqual([
      "Netflix",
      "Spotify",
      "All your regular charges",
    ]);
  });
});
