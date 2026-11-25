import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// CodeRabbit sweep 1c, area-02 (#2, #3, #6, #10): the net-worth line says what it leaves out and how
// old it is; a failed transfer needs a look; a budget beside statements that end on their month's
// last day isn't read as $0 spent.

const base = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-26",
  recurring: [],
  budgets: { daysLeft: 11, progress: [] },
  yearly: [],
  spending: null,
  books: [],
  transfers: [],
  have: {
    netCents: 500_000,
    assetsCents: 600_000,
    debtsCents: 100_000,
    investmentsCents: 0,
    ownedCents: 0,
    owned: 0,
    assetPrompt: null,
    goals: { total: 0, onTrack: 0 },
    debt: { accounts: 1, owedCents: 100_000 },
  },
  rules: 0,
} as unknown as MoneyTreeInput;
const worth = (have: Partial<MoneyTreeInput["have"]>, statementsEnd?: string) =>
  moneyTree({ ...base, have: { ...base.have, ...have }, statementsEnd }).summaries[
    "have:net-worth"
  ];

describe("the net-worth line when a debt is partly known", () => {
  it("says a loan only its payments show is left out of the owed figure", () => {
    expect(worth({ loansSeen: ["Nelnet"] })).toBe(
      "You have $6,000.00 and owe $1,000.00, not counting what you owe on Nelnet.",
    );
  });

  it("keeps the statements' end day in the first sentence beside a missing balance", () => {
    const text = worth({ missing: [{ name: "Chase card", card: true }] as never }, "2026-10-20");
    expect(text).toContain("and owe $1,000.00, from your statements, which end on Oct 20.");
    expect(text.split(/(?<=\.)\s+/).length).toBe(2);
  });
});

describe("a transfer that didn't go through", () => {
  it("needs a look, where a completed one is good", () => {
    const t = (status: string) =>
      moneyTree({
        ...base,
        transfers: [
          { id: "t1", toName: "Savings", amountCents: 5_000, status, runOn: "2026-11-20" },
        ],
      }).tree.branches.find((b) => b.id === "transfers")?.items[0]?.status;
    expect(t("failed")).toBe("look");
    expect(t("completed")).toBe("good");
    expect(t("cancelled")).toBe("good");
  });
});

describe("a budget beside statements that end on the last day of October", () => {
  it("says this month isn't in yet, not $0 spent", () => {
    const text = moneyTree({
      ...base,
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
      spending: {
        month: "2026-10",
        current: false,
        endsOn: null,
        spendingCents: 123_564,
        incomeCents: 300_000,
        categories: [],
        changes: [],
      },
    }).summaries["budgets:Transportation"];
    expect(text).toBe(
      "A $40.00 monthly budget. This month's spending isn't in yet: your statements end in October.",
    );
  });
});
