import { describe, expect, it } from "vitest";
import { plansTree, type PlansTreeInput } from "./plans";

// Debug 2 (11-16, a student paying a Nelnet student loan and a Toyota car loan from checking,
// 1280 light): Plans & goals → "Paying off cards and loans" said "On 2 cards and loans, not the
// mortgage." They have no card and no mortgage. The line names what the payoff plan covers, and
// says the mortgage is left out only when there is one.

const input = (debt: PlansTreeInput["debt"]): PlansTreeInput => ({
  asOf: "2026-11-16",
  deadlines: [],
  goals: [],
  competing: false,
  netWorth: { todayCents: 24_390, lastMonthCents: 144_390 },
  lifeEvents: { open: 0, newest: null },
  lastMonth: { label: "October" },
  year: 2026,
  yearly: { monthlyCents: 0, bills: 0 },
  debt,
});

const line = (debt: PlansTreeInput["debt"]) => plansTree(input(debt)).summaries["money:debt"];

describe("what the payoff plan is on, in Plans & goals", () => {
  it("says loans, with no mortgage to leave out", () => {
    expect(line({ accounts: 2, owedCents: 0, known: 0, cards: 0, mortgage: false })).toBe(
      "On 2 loans.",
    );
  });

  it("says a card, and leaves the mortgage out only when there is one", () => {
    expect(line({ accounts: 1, owedCents: 185_040, known: 1, cards: 1, mortgage: false })).toBe(
      "On 1 card.",
    );
    expect(line({ accounts: 3, owedCents: 900_000, known: 3, cards: 1, mortgage: true })).toBe(
      "On 3 cards and loans, not the mortgage.",
    );
  });
});
