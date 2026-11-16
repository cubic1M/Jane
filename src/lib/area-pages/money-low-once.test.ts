import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2 re-walk (11-16, upload S1: Capital One 360 to Nov 13, nothing due before Nov 20):
// Spending's "Lowest balance ahead" read "$2,073.20 on Nov 13, about $2,073.20 today. Lowest point
// about $2,073.20 on Nov 16.", one balance three times. Each figure is said once now.

const base: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [],
  budgets: { daysLeft: 14, progress: [] },
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

const summary = (l: MoneyTreeInput["lows"][number]) =>
  moneyTree({ ...base, lows: [l] }).summaries["coming:low-a1"];

describe("the lowest balance ahead says each figure once", () => {
  it("leaves out today's estimate when nothing has moved it since the statement", () => {
    expect(
      summary({
        accountId: "a1",
        name: "Capital One 360",
        startCents: 207_320,
        estimated: true,
        fromCents: 207_320,
        fromOn: "2026-11-13",
        lowCents: 207_320,
        date: "2026-11-16",
      }),
    ).toBe("$2,073.20 on Nov 13. Nothing coming up takes it lower.");
  });

  it("says nothing takes it lower when today is the lowest point", () => {
    expect(
      summary({
        accountId: "a1",
        name: "Capital One 360",
        startCents: 207_320,
        lowCents: 207_320,
        date: "2026-11-16",
      }),
    ).toBe("$2,073.20 today. Nothing coming up takes it lower.");
  });

  it("still says a lower point ahead", () => {
    expect(
      summary({
        accountId: "a1",
        name: "Capital One 360",
        startCents: 207_320,
        estimated: true,
        fromCents: 207_320,
        fromOn: "2026-11-13",
        lowCents: 189_122,
        date: "2026-12-09",
      }),
    ).toBe("$2,073.20 on Nov 13. Lowest point about $1,891.22 on Dec 9.");
  });
});
