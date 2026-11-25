import { describe, expect, it } from "vitest";
import { plansTree, type PlansTreeInput } from "./plans";

// CodeRabbit sweep 1c, area-02 (#5, #7): a debt figure that adds up only some balances says so, and
// the net-worth item says every exclusion that applies, not just the first.

const input = (over: Partial<PlansTreeInput>): PlansTreeInput => ({
  asOf: "2026-11-16",
  deadlines: [],
  goals: [],
  competing: false,
  netWorth: { todayCents: 24_390, lastMonthCents: 144_390 },
  lifeEvents: { open: 0, newest: null },
  lastMonth: { label: "October" },
  year: 2026,
  yearly: { monthlyCents: 0, bills: 0 },
  debt: { accounts: 0, owedCents: 0 },
  ...over,
});
const find = (t: ReturnType<typeof plansTree>, id: string) =>
  t.tree.branches.flatMap((b) => b.items).find((i) => i.id === id);

describe("the payoff item when only some balances are known", () => {
  const debt = { accounts: 2, owedCents: 100_000, known: 1, cards: 1, mortgage: false };
  it("labels the figure as the known balance and says how many are missing", () => {
    const t = plansTree(input({ debt }));
    const item = find(t, "money:debt");
    expect(item?.figure).toBe("$1k+");
    expect(item?.line).toBe("known balances only");
    expect(t.summaries["money:debt"]).toBe(
      "On 2 cards and loans. $1,000.00 is what's known: 1 balance missing.",
    );
  });

  it("keeps the plain figure when every balance is known", () => {
    const t = plansTree(input({ debt: { ...debt, known: 2 } }));
    expect(find(t, "money:debt")?.figure).toBe("$1k");
    expect(t.summaries["money:debt"]).toBe("On 2 cards and loans.");
  });
});

describe("the net-worth item with a card and a loan both left out", () => {
  it("says both", () => {
    const t = plansTree(
      input({
        netWorth: {
          todayCents: 24_390,
          lastMonthCents: null,
          unbalanced: [{ name: "Chase card", card: true }],
          loansSeen: ["Nelnet"],
        },
      }),
    );
    const text = t.summaries["worth:today"];
    expect(text).toContain("Chase card");
    expect(text).toContain("Nelnet");
  });
});
