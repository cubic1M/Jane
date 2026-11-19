import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2, desktop sweep 8 (11-19, upload S7: one Bank of America statement to Oct 20, read on
// Nov 19, a $40 Transportation budget set from the dock): Spending listed "Transportation, $40 left:
// $0.00 of $40.00 this month, 11 days left." The statement has none of November, so what's spent this
// month isn't known; the spending card beside it already says October "to Oct 20, where what I have
// ends".

const base = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-26",
  recurring: [],
  budgets: {
    daysLeft: 11,
    progress: [
      {
        category: "Transportation",
        budgetCents: 4_000,
        spentCents: 0,
        leftCents: 4_000,
        over: false,
      },
    ],
  },
  yearly: [],
  books: [],
  transfers: [],
  have: {
    netCents: 1_059_707,
    assetsCents: 1_059_707,
    debtsCents: 0,
    investmentsCents: 0,
    ownedCents: 0,
    owned: 0,
    assetPrompt: null,
    goals: { total: 0, onTrack: 0 },
    debt: { accounts: 0, owedCents: 0 },
  },
  rules: 0,
} as unknown as MoneyTreeInput;
const spending = (current: boolean, endsOn: string | null) => ({
  month: current ? "2026-11" : "2026-10",
  current,
  endsOn,
  spendingCents: 123_564,
  incomeCents: 300_000,
  categories: [],
  changes: [],
});
const budget = (s: ReturnType<typeof spending>) =>
  moneyTree({ ...base, spending: s } as MoneyTreeInput).summaries["budgets:Transportation"];

describe("a budget beside statements that end before this month", () => {
  it("says this month's spending isn't in yet", () => {
    expect(budget(spending(false, "2026-10-20"))).toBe(
      "A $40.00 monthly budget. This month's spending isn't in yet: your statements end on Oct 20.",
    );
  });

  it("counts this month when the data reaches it", () => {
    expect(budget(spending(true, null))).toBe("$0.00 of $40.00 this month, 11 days left.");
  });
});
