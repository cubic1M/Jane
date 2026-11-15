import { describe, expect, it } from "vitest";
import { moneyTree, type MoneyTreeInput } from "./money";

// Debugger 11-15: a demo-bank student's Spending & bills tree had Duolingo twice: under
// Subscriptions ("Needs a look, $120/yr", Cancel or review) and under Yearly bills ("Good,
// $10/mo"). One charge, two statuses. A charge Jane asks them to review is listed there only;
// a yearly bill nobody is asked about stays a yearly bill.

const input: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-11-22",
  recurring: [
    {
      key: "merchant:duolingo",
      merchant: "Duolingo",
      lastAmountCents: 2_999,
      frequency: "every three months",
      nextDate: "2026-11-19",
      annualCostCents: 11_996,
      subscription: true,
      findingId: "f1",
    },
  ],
  budgets: { daysLeft: 15, progress: [] },
  yearly: [
    {
      key: "merchant:duolingo",
      name: "Duolingo",
      monthlyCents: 1_000,
      nextDate: "2026-11-19",
      nextAmountCents: 2_999,
      byNowCents: 2_868,
    },
    {
      key: "merchant:dmv",
      name: "California DMV",
      monthlyCents: 1_800,
      nextDate: "2027-03-01",
      nextAmountCents: 21_600,
      byNowCents: 14_400,
    },
  ],
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

const ids = (tree: ReturnType<typeof moneyTree>["tree"]) =>
  tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("a subscription that is also a yearly bill", () => {
  it("is listed once, under Subscriptions, while Jane asks about it", () => {
    const all = ids(moneyTree(input).tree).filter((id) => id.endsWith("merchant:duolingo"));
    expect(all).toEqual(["subscriptions:merchant:duolingo"]);
  });

  it("stays a yearly bill when nothing asks about it", () => {
    const calm = { ...input, recurring: [{ ...input.recurring[0]!, findingId: null }] };
    expect(ids(moneyTree(calm).tree)).toContain("yearly:merchant:duolingo");
    expect(ids(moneyTree(input).tree)).toContain("yearly:merchant:dmv");
  });
});
