import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debug 2, fifth desktop sweep (11-17, Plaid sandbox default user): Spending & bills had "Last
// month, closed · $20 · OpenAI $20.00: I'm not sure what it was. · Confirm the charges". The
// month-close suggestion is only there while last month waits on a charge (src/detectors/
// controller.ts returns nothing once it's closed), so it was never closed when it said so.

const input: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [
    {
      id: "s-close",
      topic: "month_close",
      urgency: "soon",
      worthKind: "risk",
      summary: "OpenAI $20.00: I'm not sure what it was.",
      worthCents: 2_000,
    },
  ],
  lows: [],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [],
  budgets: { daysLeft: 13, progress: [] },
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

describe("last month's close on Spending & bills", () => {
  it("isn't called closed while it waits on a charge", () => {
    const item = moneyTree(input)
      .tree.branches.flatMap((b) => b.items)
      .find((i) => i.id === "spending:month_close");
    expect(item?.label).toBe("Last month's close");
  });
});
