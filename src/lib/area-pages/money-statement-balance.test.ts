import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2 re-walk (11-16, a Bank of America statement ending Oct 20, 1280 light): Spending's
// "Lowest balance ahead" said "About $12,511.09 today" while Home's net worth said $10,597.07, the
// statement's balance: two "today" figures. The forecast walks an old statement forward with the
// pay and bills it expects; the line now says the statement's balance and day first, as /bills
// does: "$10,597.07 on Oct 20, about $12,511.09 today".

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

const low = {
  accountId: "a1",
  name: "Bank of America checking",
  startCents: 1_251_109,
  lowCents: 1_141_311,
  date: "2026-12-12",
};
const summary = (l: MoneyTreeInput["lows"][number]) =>
  moneyTree({ ...base, lows: [l] }).summaries["coming:low-a1"];

describe("the lowest balance ahead, from an old statement", () => {
  it("says the statement's balance and day before today's estimate", () => {
    expect(summary({ ...low, estimated: true, fromCents: 1_059_707, fromOn: "2026-10-20" })).toBe(
      "$10,597.07 on Oct 20, about $12,511.09 today. Lowest point about $11,413.11 on Dec 12.",
    );
  });

  it("says today's balance plainly when it is today's", () => {
    expect(summary(low)).toBe("$12,511.09 today. Lowest point about $11,413.11 on Dec 12.");
  });
});
