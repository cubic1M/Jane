import { describe, expect, it } from "vitest";
import { plansTree, type PlansTreeInput } from "./plans";

// Debugger 11-15: a student with one checking account opened Plans & goals and half the tree said
// there was nothing: "All your dates: 0 in 30 days. Nothing dated in the next month.", "Yearly
// bills: No yearly bills found yet.", "Paying off cards and loans: No cards or loans to pay off."
// A list with nothing in it isn't shown; it comes back once there is something to see.

const input = (over: Partial<PlansTreeInput> = {}): PlansTreeInput => ({
  asOf: "2026-11-15",
  deadlines: [],
  goals: [],
  competing: false,
  netWorth: { todayCents: 401_777, lastMonthCents: 372_807 },
  lifeEvents: { open: 0, newest: null },
  lastMonth: { label: "October" },
  year: 2026,
  yearly: { monthlyCents: 0, bills: 0 },
  debt: { accounts: 0, owedCents: 0 },
  ...over,
});

const ids = (over?: Partial<PlansTreeInput>) =>
  plansTree(input(over)).tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("Plans & goals for someone with nothing dated, no yearly bills and no debts", () => {
  it("doesn't list the empty lists", () => {
    const shown = ids();
    expect(shown).not.toContain("coming:all");
    expect(shown).not.toContain("money:yearly");
    expect(shown).not.toContain("money:debt");
    expect(shown).toContain("worth:today");
  });

  it("lists each once there is something in it", () => {
    const shown = ids({
      deadlines: [
        {
          key: "d",
          title: "Netflix renews",
          date: "2026-12-03",
          kind: "renewal",
          amountCents: 1_549,
        },
      ],
      yearly: { monthlyCents: 1_800, bills: 1 },
      debt: { accounts: 1, owedCents: 120_000, known: 1 },
    });
    expect(shown).toEqual(expect.arrayContaining(["coming:all", "money:yearly", "money:debt"]));
  });
});
