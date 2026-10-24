import { describe, expect, it } from "vitest";
import { investingTree, type InvestingTreeInput } from "./investing";
import { LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// The Investing page as a tree (docs/design/area-pages.md): few words per node, Jane's ideas
// on real money first, the practice portfolio with its strategies and news alerts, and the
// sub-pages as items.

const input = (over: Partial<InvestingTreeInput> = {}): InvestingTreeInput => ({
  suggestions: [
    {
      key: "s1",
      topic: "investment_fees",
      short: "Your 401(k) funds cost $640 a year more than the plan's index funds",
      worthCents: 64_000,
      worthKind: "save",
      urgency: "soon",
    },
  ],
  accounts: [
    { id: "a1", name: "Demo 401(k) ····0005", balanceCents: 8_245_000, holdings: 3 },
    { id: "a2", name: "Demo Brokerage ····0006", balanceCents: 1_200_000, holdings: 0 },
  ],
  totalCents: 9_445_000,
  byType: 3,
  cryptoCents: 0,
  profile: { complete: false, label: null },
  returns: { periods: 3 },
  months: true,
  practice: {
    started: true,
    ideas: [
      {
        key: "i1",
        kind: "dip_buy",
        headline: "VTI is down 8% this month: buy $500 on practice money",
        percent: 72,
        worthCents: 0,
      },
      {
        key: "i2",
        kind: "news_idea",
        headline: "Apple beat expectations",
        percent: 55,
        worthCents: 0,
      },
    ],
    strategy: { label: "Buy the dip, monthly", followed: false, note: "Paused by your caps." },
  },
  ...over,
});

describe("the investing tree", () => {
  it("keeps every node to six words and every summary to two sentences", () => {
    const { tree, summaries } = investingTree(input());
    const labels = [
      tree.label,
      ...tree.branches.flatMap((b) => [b.label, ...b.items.map((i) => i.label)]),
    ];
    // A label is the topic's; a detector line or headline is cut and marked with "…".
    for (const l of labels) expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const [id, s] of Object.entries(summaries))
      expect(sentences(s), id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    expect(tree.branches[0].items[0].label).toBe("Lower your fund fees");
  });

  it("puts ideas on real money first and reference last", () => {
    const { tree } = investingTree(input());
    expect(tree.branches.map((b) => b.id)).toEqual([
      "ideas",
      "owned",
      "done",
      "practice",
      "strategies",
      "news",
      "plan",
      "kinds",
      "costs",
    ]);
    // Without demo advice there's no practice research: no strategies or news alerts.
    const real = investingTree(input({ practice: null })).tree.branches.map((b) => b.id);
    expect(real).not.toContain("strategies");
    expect(real).not.toContain("news");
    expect(real).toContain("practice");
  });

  it("sorts practice ideas from news alerts, each with how sure Jane is", () => {
    const { tree } = investingTree(input());
    const branch = (id: string) => tree.branches.find((b) => b.id === id)!;
    expect(branch("practice").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["VTI is down 8% this month:…", "look", "72% sure"],
      ["Your practice portfolio", undefined, undefined],
    ]);
    expect(branch("news").items.map((i) => [i.label, i.figure])).toEqual([
      ["Apple beat expectations", "55% sure"],
      // The news themes and their past record, always there to open.
      ["News themes", undefined],
    ]);
    expect(branch("strategies").items.map((i) => i.label)).toContain("More strategies");
    expect(branch("strategies").items[0]).toMatchObject({
      label: "Your strategy today",
      status: "look",
    });
    expect(branch("owned").items.map((i) => [i.label, i.figure])).toEqual([
      ["In total", "$94k"],
      ["Demo 401(k) ····0005", "$82k"],
      ["Demo Brokerage ····0006", "$12k"],
      ["By type", undefined],
    ]);
    expect(branch("plan").items[0]).toMatchObject({ status: "look", figure: "4 questions" });
    expect(tree.sub).toBe("5 to look at");
  });

  it("says when the news is quiet, and lifts urgent ideas to the chips", () => {
    const quiet = investingTree(
      input({ practice: { started: true, ideas: [], strategy: null } }),
    ).tree.branches.find((b) => b.id === "news")!;
    expect(quiet.items.map((i) => i.label)).toEqual(["Nothing in the news now", "News themes"]);

    const { chips, tree } = investingTree(
      input({
        suggestions: [
          {
            key: "a",
            topic: "new_kind",
            short: "Idle cash",
            worthCents: 10_000,
            worthKind: "save",
            urgency: "now",
          },
          {
            key: "b",
            topic: "new_kind",
            short: "Old 401(k)",
            worthCents: 90_000,
            worthKind: "save",
            urgency: "now",
          },
        ],
      }),
    );
    expect(chips).toEqual([
      { id: "ideas:b", label: "Old 401(k)", figure: "$900/yr" },
      { id: "ideas:a", label: "Idle cash", figure: "$100/yr" },
    ]);
    expect(tree.sub).toBe("2 urgent · 4 to look at");
  });

  it("shows the money invested when nothing needs a look", () => {
    const { tree, chips } = investingTree(
      input({
        suggestions: [],
        profile: { complete: true, label: "Growth, 25 years" },
        practice: null,
      }),
    );
    expect(chips).toEqual([]);
    expect(tree.sub).toBe("$94k invested");
  });
});
