import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debugger 11-13, Spending & bills at 1280: "All your regular charges $44k/yr · 9 subscriptions".
// The $44k was 9 subscriptions and 10 other bills, the mortgage among them; the line counted only
// the subscriptions, so it read as nine subscriptions costing $44k a year.

const charge = (merchant: string, annualCostCents: number, subscription: boolean) => ({
  key: `merchant:${merchant.toLowerCase()}`,
  merchant,
  lastAmountCents: Math.round(annualCostCents / 12),
  frequency: "a month",
  nextDate: null,
  annualCostCents,
  subscription,
  findingId: null,
});

const input: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-20",
  recurring: [
    charge("Netflix", 21_588, true),
    charge("Spotify", 14_388, true),
    charge("Rocket Mortgage", 2_637_972, false),
  ],
  budgets: { daysLeft: 17, progress: [] },
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

describe("all your regular charges", () => {
  it("counts every charge its yearly figure adds up, not just the subscriptions", () => {
    const { tree, summaries } = moneyTree(input);
    const all = tree.branches.flatMap((b) => b.items).find((i) => i.id === "subscriptions:all");
    expect(all?.line).toBe("3 regular charges");
    // The detail still says which are which.
    expect(summaries["subscriptions:all"]).toContain("2 subscriptions and 1 other regular bill");
  });
});
