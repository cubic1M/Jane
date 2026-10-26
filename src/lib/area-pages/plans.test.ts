import { describe, expect, it } from "vitest";
import { plansTree, type PlansTreeInput } from "./plans";
import { LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// The Plans & goals page as a tree (docs/design/area-pages.md): few words per node, dates
// soon first, each goal on track or not, and few chips by design.

const input = (over: Partial<PlansTreeInput> = {}): PlansTreeInput => ({
  asOf: "2026-10-23",
  deadlines: [
    { key: "card", title: "Card payment due", date: "2026-10-26", amountCents: 7_800 },
    { key: "renewal", title: "GEICO renews", date: "2026-11-02", amountCents: 85_200 },
    { key: "return", title: "Return window closes", date: "2026-11-20", amountCents: null },
  ],
  goals: [
    {
      id: "g1",
      name: "Emergency fund",
      targetCents: 1_000_000,
      targetDate: "2027-06-30",
      status: "on_the_way",
      savedCents: 320_000,
      monthlyCents: 85_000,
      lateMonths: 0,
    },
    {
      id: "g2",
      name: "Trip to Japan",
      targetCents: 600_000,
      targetDate: "2027-03-31",
      status: "on_the_way",
      savedCents: 50_000,
      monthlyCents: 110_000,
      lateMonths: 3,
    },
  ],
  competing: true,
  netWorth: { todayCents: 16_546_850, lastMonthCents: 16_400_000 },
  lifeEvents: { open: 0, newest: null },
  lastMonth: { label: "September" },
  year: 2026,
  yearly: { monthlyCents: 5_800, bills: 3 },
  debt: { accounts: 4, owedCents: 8_652_000 },
  ...over,
});

describe("the plans and goals tree", () => {
  it("keeps every node to six words and every summary to two sentences", () => {
    const { tree, summaries } = plansTree(input());
    const labels = [
      tree.label,
      ...tree.branches.flatMap((b) => [b.label, ...b.items.map((i) => i.label)]),
    ];
    for (const l of labels) expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const [id, s] of Object.entries(summaries))
      expect(sentences(s), id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
  });

  it("puts what's coming first and reference last", () => {
    const { tree } = plansTree(input());
    expect(tree.branches.map((b) => b.id)).toEqual([
      "coming",
      "goals",
      "worth",
      "decide",
      // Life events and the look-backs open pages the read-only beta hides
      // (src/config/hidden-pages.ts), so those branches are empty for now.
      "money",
    ]);
    // No accounts linked: no net worth to show.
    expect(plansTree(input({ netWorth: null })).tree.branches.map((b) => b.id)).not.toContain(
      "worth",
    );
  });

  it("marks dates by how close they are, and goals by whether they're on time", () => {
    const { tree, summaries } = plansTree(input());
    const branch = (id: string) => tree.branches.find((b) => b.id === id)!;
    // Within three days is urgent; within two weeks a look; later only in "All your dates".
    expect(branch("coming").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Card payment due", "act", "$78 · Oct 26"],
      ["GEICO renews", "look", "$852 · Nov 2"],
      ["All your dates", "good", "3 in 30 days"],
    ]);
    expect(branch("goals").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Emergency fund", "good", "$3.2k of $10k"],
      ["Trip to Japan", "look", "$500 of $6k"],
      ["Goals that compete", "look", undefined],
      ["Add a goal", undefined, undefined],
    ]);
    expect(summaries["goals:g1"]).toBe("$850 a month gets you there by Jun 2027.");
    expect(summaries["goals:g2"]).toBe(
      "$1.1k a month would get there by Mar 2027; with your other goals it's 3 months late.",
    );
    expect(summaries["worth:today"]).toBe("Up $1.5k since the end of last month.");
    expect(summaries["money:debt"]).toBe("On 4 cards and loans, not the mortgage.");
    expect(tree.sub).toBe("1 urgent · 3 to look at");
  });

  it("lifts only urgent dates to the chips, at most three, biggest first", () => {
    const deadlines = [10_000, 30_000, 20_000, 40_000].map((amountCents, n) => ({
      key: `d${n}`,
      title: `Bill ${n}`,
      date: "2026-10-24",
      amountCents,
    }));
    const { chips } = plansTree(input({ deadlines }));
    expect(chips).toEqual([
      { id: "coming:d3", label: "Bill 3", figure: "$400 · Oct 24" },
      { id: "coming:d1", label: "Bill 1", figure: "$300 · Oct 24" },
      { id: "coming:d2", label: "Bill 2", figure: "$200 · Oct 24" },
    ]);
  });

  it("counts goals on track when nothing is urgent, and is all good with nothing at all", () => {
    expect(plansTree(input({ deadlines: [] })).tree.sub).toBe("1 of 2 goals on track");
    const { tree, chips } = plansTree(input({ deadlines: [], goals: [], competing: false }));
    expect(chips).toEqual([]);
    expect(tree.sub).toBe("All good");
    expect(tree.branches.find((b) => b.id === "goals")!.items.map((i) => i.label)).toEqual([
      "Set a goal",
    ]);
  });
});
