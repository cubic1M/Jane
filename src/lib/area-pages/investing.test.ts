import { ADVICE_TOPICS } from "@/config/suggestions";
import { describe, expect, it } from "vitest";
import { TOPIC_LABELS, investingTree, type InvestingTreeInput } from "./investing";
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
    expect(tree.branches[0].items[0].label).toBe("What your funds cost");
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
      // The plan, the kinds of accounts and costs and care open pages the read-only beta hides
      // (src/config/hidden-pages.ts), so they aren't in the tree for now.
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
    // Every strategy tested is on the page's strategy board, above the tree, not an item.
    expect(branch("strategies").items.map((i) => i.label)).not.toContain("More strategies");
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
    // The investor profile's page is hidden in the read-only beta, so it isn't counted.
    expect(branch("plan")).toBeUndefined();
    expect(tree.sub).toBe("4 to look at");
  });

  it("puts a news theme's idea under the news alerts", () => {
    const news = investingTree(
      input({
        practice: {
          started: true,
          ideas: [
            {
              key: "t1",
              kind: "theme_idea",
              headline: "Defense when a war breaks out: $400 in ITA",
              percent: 67,
              worthCents: 40_000,
            },
          ],
          strategy: null,
        },
      }),
    ).tree.branches.find((b) => b.id === "news")!;
    expect(news.items.map((i) => i.label)[0]).toMatch(/^Defense when a war breaks out/);
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
    // The investor profile (its page hidden in the read-only beta) isn't one to look at.
    expect(tree.sub).toBe("2 urgent · 3 to look at");
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

  it("says how many balances are still to answer, not all good", () => {
    const { tree } = investingTree(
      input({ suggestions: [], accounts: [], totalCents: 0, toAnswer: 2, practice: null }),
    );
    expect(tree.sub).toBe("2 to answer");
  });
});

// Debugger 11-01: a real account (Schwab positions) saw "Put waiting cash to work · $73/yr" among
// Jane's ideas. The topic is kept for everyone because it is a fact (what the cash earns), but its
// label told them to invest it. A topic a real account sees is labelled as a fact.
describe("labels of the ideas a real account sees", () => {
  it.each(
    Object.entries(TOPIC_LABELS).filter(
      ([topic]) => !(ADVICE_TOPICS as readonly string[]).includes(topic),
    ),
  )("%s reads as a fact: %s", (_topic, label) => {
    expect(label).not.toMatch(/^(?:put|invest|lower|switch|move|rebalance|roll|buy|sell)\b/i);
  });
});
