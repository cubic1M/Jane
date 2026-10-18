import { describe, expect, it } from "vitest";
import { proposals, type ProposalInput } from "./proposals";

const input = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  asOf: "2026-10-18",
  suggestions: {
    "Food and drink": 50_000,
    Services: 40_000,
    Entertainment: 3_000,
    Shopping: 1_000,
    Uncategorized: 90_000,
  },
  budgetedCategories: [],
  goalNames: [],
  monthlySpendingCents: 320_000,
  uncategorized: [],
  ...over,
});

describe("set-up proposals", () => {
  it("proposes budgets for the biggest categories without one, from the person's averages", () => {
    const budgets = proposals(input({ budgetedCategories: ["Services"] })).filter(
      (p) => p.kind === "budget",
    );
    expect(budgets).toEqual([
      {
        kind: "budget",
        key: "budget:Food and drink",
        category: "Food and drink",
        amountCents: 50_000,
      },
      {
        kind: "budget",
        key: "budget:Entertainment",
        category: "Entertainment",
        amountCents: 3_000,
      },
    ]);
  });

  it("proposes an emergency fund of three months' spending, a year out, unless there is one", () => {
    expect(proposals(input()).find((p) => p.kind === "goal")).toEqual({
      kind: "goal",
      key: "goal:emergency_fund",
      name: "Emergency fund",
      targetCents: 960_000,
      targetDate: "2027-10-18",
      monthlySpendingCents: 320_000,
    });
    expect(
      proposals(input({ goalNames: ["My emergency savings"] })).some((p) => p.kind === "goal"),
    ).toBe(false);
    expect(proposals(input({ monthlySpendingCents: 0 })).some((p) => p.kind === "goal")).toBe(
      false,
    );
  });

  it("proposes a category only from the merchant directory, never a guess", () => {
    const found = proposals(
      input({
        uncategorized: [
          {
            merchantKey: "canva",
            merchantName: "Canva",
            transactions: 3,
            directoryCategory: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
          },
          {
            merchantKey: "oak street",
            merchantName: "Oak Street",
            transactions: 12,
            directoryCategory: null,
          },
          {
            merchantKey: "once",
            merchantName: "Once",
            transactions: 1,
            directoryCategory: "TRAVEL_FLIGHTS",
          },
        ],
      }),
    ).filter((p) => p.kind === "category");
    expect(found.map((p) => p.key)).toEqual(["category:canva"]);
  });
});
