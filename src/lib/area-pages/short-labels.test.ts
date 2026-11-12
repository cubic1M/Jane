import { describe, expect, it } from "vitest";
import { plansTree } from "./plans";
import { LABEL_MAX_WORDS, words } from "./tree";

// Debugger 11-12: Plans & goals' urgent chip read "Last day of open enrollment at": the deadline
// "Last day of open enrollment at <employer>" cut at the six-word budget, mid-phrase. A label cut
// short ends on a word that means something, never on "at", "of", "for" or "the".

const DANGLING = /\b(?:at|of|for|to|the|a|an|in|on|with|and|or|by|from|&)$/i;

const tree = () =>
  plansTree({
    asOf: "2026-11-12",
    deadlines: [
      {
        key: "work-enrollment:2026-11-13:end",
        title: "Last day of open enrollment at Acme Logistics",
        date: "2026-11-13",
        amountCents: null,
      },
      {
        key: "return",
        title: "Return window for the order from West Marine",
        date: "2026-11-14",
        amountCents: 64_000,
      },
    ],
    goals: [
      {
        id: "g1",
        name: "Save for the deposit on an apartment",
        targetCents: 300_000,
        targetDate: "2027-06-30",
        status: "on_the_way",
        savedCents: 20_000,
        monthlyCents: 25_000,
        lateMonths: 0,
      },
    ],
    competing: false,
    netWorth: { todayCents: 100_000, lastMonthCents: null },
    lifeEvents: { open: 0, newest: null },
    lastMonth: { label: "October" },
    year: 2026,
    yearly: { monthlyCents: 0, bills: 0 },
    debt: { accounts: 0, owedCents: 0 },
  });

describe("a label cut to the word budget", () => {
  it("never ends on a word that leads into the part cut off", () => {
    const { tree: t, chips } = tree();
    const labels = [
      ...t.branches.flatMap((b) => b.items.map((i) => i.label)),
      ...chips.map((c) => c.label),
    ];
    for (const l of labels) {
      expect(l, l).not.toMatch(DANGLING);
      expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    }
    expect(labels).toContain("Last day of open enrollment");
  });
});
