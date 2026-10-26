import { describe, expect, it } from "vitest";
import {
  COMPARE_TOPICS,
  LOANS_BRANCHES,
  TOPIC_LABELS,
  compareWant,
  loansTree,
  type LoansTreeInput,
} from "./loans";
import { LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// The Loans & credit page as a tree (docs/design/area-pages.md): few words per node, money lost
// first, and at most three urgent chips with their dollar figure.

const input = (over: Partial<LoansTreeInput> = {}): LoansTreeInput => ({
  asOf: "2026-10-23",
  debts: [
    {
      key: "account:card",
      name: "Demo Credit Card ····2003",
      kindLabel: "Credit card",
      balanceCents: 312_000,
      aprBps: 2149,
      paymentCents: 7_800,
      nextDue: "2026-10-26",
      overdue: false,
      pastDueCents: null,
      inNetWorth: true,
    },
    {
      key: "account:car",
      name: "Demo Car Loan ····2005",
      kindLabel: "Car loan",
      balanceCents: 2_140_000,
      aprBps: 540,
      paymentCents: 46_800,
      nextDue: "2026-11-08",
      overdue: true,
      pastDueCents: 46_800,
      inNetWorth: true,
    },
  ],
  suggestions: [
    {
      key: "debt:card_interest",
      topic: "card_interest",
      short: "You paid $556.80 in card interest over 12 months.",
      worthCents: 67_049,
      worthKind: "saves",
      urgency: "soon",
    },
    {
      key: "debt:high_cost_loans",
      topic: "high_cost_loans",
      short: "Payday loans cost you $364 in the last year.",
      worthCents: 36_400,
      worthKind: "saves",
      urgency: "soon",
    },
    {
      key: "debt:refinance",
      topic: "refinance",
      short: "Your rate is 5.80% on $62,000.00.",
      worthCents: 30_000,
      worthKind: "saves",
      urgency: "later",
    },
    {
      key: "debt:rent_increase",
      topic: "rent_increase",
      short: "Your rent rose 9.8%, against a usual 4%.",
      worthCents: 156_000,
      worthKind: "risk",
      urgency: "soon",
    },
  ],
  installments: 0,
  payoff: { debtFreeMonth: "2036-06" },
  credit: { score: 720, share: 0.39, toUnderHighCents: 72_000 },
  review: { needYou: 2, on: "2026-10-24" },
  ...over,
});

describe("the Loans & credit tree", () => {
  it("keeps every node to six words and every summary to two sentences", () => {
    const { tree, summaries } = loansTree(input());
    const labels = tree.branches.flatMap((b) => [b.label, ...b.items.map((i) => i.label)]);
    for (const l of labels) expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const l of Object.values(TOPIC_LABELS)) {
      expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    }
    for (const [id, s] of Object.entries(summaries)) {
      expect(sentences(s), id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    }
  });

  it("puts what's costing money first, and the reference branches last", () => {
    const { tree } = loansTree(input());
    // The debt review's page is hidden in the read-only beta (src/config/hidden-pages.ts), so
    // Reviews has nothing in it for now.
    expect(tree.branches.map((b) => b.id)).toEqual(
      Object.keys(LOANS_BRANCHES).filter((b) => b !== "reviews"),
    );
    const branch = (id: string) => tree.branches.find((b) => b.id === id)!;
    expect(branch("costs").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Card interest you can cut", "look", "$670/yr"],
      ["Costly short-term borrowing", "act", "$364/yr"],
    ]);
    expect(branch("debts").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Demo Credit Card ····2003", "good", "$3.1k at 21.49%"],
      ["Demo Car Loan ····2005", "act", "$21k at 5.40%"],
    ]);
    expect(branch("cheaper").items.map((i) => i.label)).toEqual(["A cheaper loan"]);
    expect(branch("payoff").items[0]).toMatchObject({ figure: "Debt-free Jun 2036" });
    expect(branch("credit").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Your credit score", "good", "720"],
      ["Card use", "look", "39%"],
    ]);
    // Only what isn't a way to a hidden page: the best card stays.
    expect(branch("borrow").items.map((i) => i.label)).toEqual(["Best card for your spending"]);
    expect(branch("family").items[0]).toMatchObject({
      label: "Your rent went up",
      figure: "$1.6k",
    });
    expect(tree.sub).toBe("2 urgent · 4 to look at");
  });

  it("lifts the urgent items to the top, biggest dollars first", () => {
    const { chips } = loansTree(input());
    expect(chips.map((c) => c.id)).toEqual(["debts:account:car", "costs:high_cost_loans"]);
  });

  it("is all good with nothing to do, and draws no empty branch", () => {
    const { tree, chips } = loansTree(
      input({
        debts: [{ ...input().debts[0] }],
        suggestions: [],
        credit: { score: 760, share: 0.08, toUnderHighCents: 0 },
        review: { needYou: 0, on: null },
      }),
    );
    expect(chips).toEqual([]);
    expect(tree.sub).toBe("All good");
    expect(tree.branches.map((b) => b.id)).not.toContain("costs");
    expect(tree.branches.map((b) => b.id)).not.toContain("family");
    expect(tree.branches.find((b) => b.id === "cheaper")!.items.map((i) => i.label)).toEqual([
      "Refinance offers",
    ]);
  });
});

describe("compareWant", () => {
  const debts = [
    { key: "card:1", kind: "card" },
    { key: "auto:1", kind: "auto" },
  ];
  it("prices a loan choice for comparison cards, a car refinance for the car loan", () => {
    expect(compareWant("refinance", debts)).toEqual({ need: "refinance" });
    expect(compareWant("consolidation", debts)).toEqual({ need: "consolidation" });
    expect(compareWant("auto_refinance", debts)).toEqual({ need: "refinance", debtKey: "auto:1" });
    expect(compareWant("auto_refinance", [])).toEqual({ need: "refinance" });
    expect(compareWant("credit_building", debts)).toBeNull();
    for (const t of COMPARE_TOPICS) expect(compareWant(t, debts)).not.toBeNull();
  });
});
