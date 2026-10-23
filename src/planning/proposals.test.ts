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
      basis: "3 months of your own average spending",
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

  // Spec step 70.
  it("proposes a Yearly bills goal of a year of the monthly set-aside", () => {
    expect(
      proposals(input({ yearlyBillsMonthlyCents: 2_800 })).find(
        (p) => p.key === "goal:yearly_bills",
      ),
    ).toEqual({
      kind: "goal",
      key: "goal:yearly_bills",
      name: "Yearly bills",
      targetCents: 33_600,
      targetDate: "2027-10-18",
      monthlySpendingCents: 320_000,
      monthlySetAsideCents: 2_800,
    });
  });

  it("proposes no Yearly bills goal without yearly bills, or to someone who has one", () => {
    const keys = (over: Partial<ProposalInput>) => proposals(input(over)).map((p) => p.key);
    expect(keys({ yearlyBillsMonthlyCents: 0 })).not.toContain("goal:yearly_bills");
    expect(keys({})).not.toContain("goal:yearly_bills");
    expect(keys({ yearlyBillsMonthlyCents: 2_800, goalNames: ["Yearly bills"] })).not.toContain(
      "goal:yearly_bills",
    );
    // The emergency fund is still proposed alongside it.
    expect(keys({ yearlyBillsMonthlyCents: 2_800 })).toContain("goal:emergency_fund");
  });
});

// Spec step 263 (QA sweep): the emergency fund is sized for the person.
describe("the emergency fund proposal", () => {
  const fund = (over: Partial<ProposalInput> = {}) =>
    proposals(input(over)).find((p) => p.kind === "goal" && p.key === "goal:emergency_fund");
  it("is three months of spending without a profile", () => {
    expect(fund()).toMatchObject({
      targetCents: 960_000,
      name: "Emergency fund",
      basis: "3 months of your own average spending",
    });
  });
  it("is six months for Sam, whose pay moves around, and says so", () => {
    // The plan and the chat used to say three months whatever the size (cluster 13).
    expect(
      fund({ profile: { pattern: "uneven", debtTrouble: false, incomeCents: 453_781 } }),
    ).toMatchObject({ targetCents: 1_920_000, basis: "6 months of your own average spending" });
  });
  it("is a small starter buffer for Chris, who is overdrawn and in debt trouble", () => {
    const f = fund({ profile: { pattern: "salary", debtTrouble: true, incomeCents: 242_000 } });
    expect(f).toMatchObject({ targetCents: 100_000, name: "Emergency starter buffer" });
    expect(f).toMatchObject({ targetDate: "2027-04-18" });
    expect(f).toMatchObject({ basis: "a starter buffer while paying off debt comes first" });
  });
  it("is nothing for Ruth when her pension covers what she spends", () => {
    expect(
      fund({
        monthlySpendingCents: 320_000,
        profile: { pattern: "pension", debtTrouble: false, incomeCents: 452_000 },
      }),
    ).toBeUndefined();
  });
  it("is the gap for a retiree whose pension falls short", () => {
    expect(
      fund({
        monthlySpendingCents: 500_000,
        profile: { pattern: "pension", debtTrouble: false, incomeCents: 452_000 },
      }),
    ).toMatchObject({ targetCents: 580_000 });
  });
});
