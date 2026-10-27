import { describe, expect, it } from "vitest";
import { areaOfCapability } from "@/config/areas";
import { DETECTORS } from "@/detectors";
import {
  BOOKS_LABELS,
  MONEY_BRANCHES,
  SUGGESTION_NODES,
  moneyTree,
  type MoneyTreeInput,
} from "./money";
import { CHIPS_MAX, LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// Spending & bills as a tree (docs/design/area-pages.md): few words per node, a branch's status
// from its items, and at most three urgent chips, biggest first.

const EMPTY: MoneyTreeInput = {
  hasAccounts: true,
  cushionCents: 10_000,
  suggestions: [],
  lows: [],
  bills: [],
  weekEnds: "2026-10-30",
  recurring: [],
  budgets: { daysLeft: 8, progress: [] },
  yearly: [],
  spending: null,
  books: [],
  transfers: [],
  have: {
    netCents: 4_820_000,
    assetsCents: 6_000_000,
    debtsCents: 1_180_000,
    investmentsCents: 0,
    ownedCents: 0,
    owned: 0,
    assetPrompt: null,
    goals: { total: 0, onTrack: 0 },
    debt: { accounts: 0, owedCents: 0 },
  },
  rules: 0,
};

const FULL: MoneyTreeInput = {
  ...EMPTY,
  suggestions: [
    {
      id: "s1",
      topic: "duplicate_charge",
      summary: "Spotify charged you $10.99 twice on Oct 3. Ask for one back.",
      worthCents: 1_099,
      urgency: "soon",
    },
    {
      id: "s2",
      topic: "bill_negotiation",
      summary: "Comcast costs more than most plans like it. Jane can ask for a lower rate.",
      worthCents: 24_000,
      urgency: "later",
    },
    {
      id: "s3",
      topic: "price_increase",
      summary: "Netflix went up $3 a month.",
      worthCents: 3_600,
      urgency: "now",
    },
    { id: "s4", topic: "not_on_the_map", summary: "Ignored.", worthCents: 0, urgency: "now" },
  ],
  lows: [
    {
      accountId: "chk",
      name: "Everyday Checking",
      startCents: 120_000,
      lowCents: 4_000,
      date: "2026-10-30",
    },
    {
      accountId: "sav",
      name: "Savings",
      startCents: 900_000,
      lowCents: 900_000,
      date: "2026-10-23",
    },
  ],
  bills: [
    { merchant: "Rent", date: "2026-10-25", amountCents: 146_000 },
    { merchant: "Verizon", date: "2026-11-05", amountCents: 8_500 },
  ],
  recurring: [
    {
      key: "merchant:hulu",
      merchant: "Hulu",
      lastAmountCents: 1_799,
      frequency: "a month",
      nextDate: "2026-11-02",
      annualCostCents: 21_588,
      subscription: true,
      findingId: "f1",
    },
    {
      key: "merchant:verizon",
      merchant: "Verizon",
      lastAmountCents: 8_500,
      frequency: "a month",
      nextDate: "2026-11-05",
      annualCostCents: 102_000,
      subscription: false,
      findingId: null,
    },
  ],
  budgets: {
    daysLeft: 8,
    progress: [
      {
        category: "Food and drink",
        budgetCents: 40_000,
        spentCents: 44_000,
        leftCents: -4_000,
        over: true,
      },
      {
        category: "Shopping",
        budgetCents: 20_000,
        spentCents: 5_000,
        leftCents: 15_000,
        over: false,
      },
    ],
  },
  yearly: [
    {
      key: "merchant:geico",
      name: "GEICO",
      monthlyCents: 8_500,
      nextDate: "2027-03-01",
      nextAmountCents: 102_000,
      byNowCents: 59_500,
    },
  ],
  spending: {
    month: "2026-10",
    spendingCents: 231_000,
    incomeCents: 400_000,
    categories: [{ category: "Rent and utilities", cents: 145_000 }],
    changes: [
      { category: "Food and drink", beforeCents: 26_000, afterCents: 44_000, changeCents: 18_000 },
      { category: "Travel", beforeCents: 30_000, afterCents: 0, changeCents: -30_000 },
    ],
  },
  books: [
    {
      id: "b1",
      kind: "stale",
      imported: true,
      words:
        "Chase checking's data ends on 2026-10-20, the last day in the file you imported, so I can't see anything after it. Import a newer file and I'll pick up from there.",
    },
  ],
  transfers: [
    { id: "t1", toName: "Savings", amountCents: 20_000, status: "pending", runOn: "2026-10-24" },
  ],
  have: {
    ...EMPTY.have,
    goals: { total: 3, onTrack: 2 },
    debt: { accounts: 2, owedCents: 1_180_000 },
  },
  rules: 2,
};

const allItems = (input: MoneyTreeInput) => moneyTree(input).tree.branches.flatMap((b) => b.items);

describe("moneyTree", () => {
  it("keeps every label and summary within the copy budget", () => {
    const area = moneyTree(FULL);
    for (const b of area.tree.branches) expect(words(b.label)).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const i of allItems(FULL)) {
      expect(words(i.label), i.label).toBeLessThanOrEqual(LABEL_MAX_WORDS);
      expect(sentences(area.summaries[i.id]), i.id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    }
    for (const label of [
      ...Object.values(SUGGESTION_NODES).map((n) => n.label),
      ...Object.values(BOOKS_LABELS),
    ])
      expect(words(label), label).toBeLessThanOrEqual(LABEL_MAX_WORDS);
  });

  // Overnight upload QA: card statements carry no balance; a cushion is an amount, not a year.
  it("says a card balance isn't known, and shows a cushion as an amount", () => {
    const unknown = {
      ...FULL,
      have: { ...FULL.have, debt: { accounts: 1, owedCents: 0, known: 0 } },
    };
    const loans = allItems(unknown).find((i) => i.id === "have:loans")!;
    expect(loans.figure).toBe("Not known");
    const cushion = {
      ...FULL,
      suggestions: [
        {
          id: "s1",
          topic: "emergency_fund",
          summary: "A cushion for emergencies.",
          worthCents: 200_000,
          urgency: "soon",
          worthKind: "risk",
        },
      ],
    };
    expect(allItems(cushion).find((i) => i.id === "coming:emergency_fund")!.figure).toBe("$2k");
  });

  // Overnight upload QA: "Uncategorized is up +$3" asked for a look.
  it("says a category is up only when it rose by enough", () => {
    const small = {
      ...FULL,
      spending: {
        ...FULL.spending!,
        changes: [
          { category: "Uncategorized", beforeCents: 20_000, afterCents: 20_300, changeCents: 300 },
          { category: "Shopping", beforeCents: 90_000, afterCents: 93_000, changeCents: 3_000 },
          {
            category: "Food and drink",
            beforeCents: 26_000,
            afterCents: 44_000,
            changeCents: 18_000,
          },
        ],
      },
    };
    expect(
      allItems(small)
        .filter((i) => i.id.startsWith("spending:up-"))
        .map((i) => i.id),
    ).toEqual(["spending:up-Food and drink"]);
  });

  it("names a branch and a label for every detector in the area", () => {
    const topics = DETECTORS.filter((d) => areaOfCapability(d.capability) === "money").map(
      (d) => d.topic,
    );
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(SUGGESTION_NODES[topic], topic).toBeDefined();
  });

  it("orders the branches money lost first, reference last, and hides empty ones", () => {
    expect(moneyTree(FULL).tree.branches.map((b) => b.id)).toEqual(Object.keys(MONEY_BRANCHES));
    expect(moneyTree(EMPTY).tree.branches.map((b) => b.id)).toEqual([
      "budgets",
      "have",
      "transactions",
    ]);
  });

  it("marks money being lost as urgent and the rest as worth a look", () => {
    const status = (id: string) => allItems(FULL).find((i) => i.id === id)?.status;
    expect(status("charges:duplicate_charge")).toBe("act");
    expect(status("charges:price_increase")).toBe("act");
    expect(status("charges:bill_negotiation")).toBe("look");
    expect(status("coming:low-chk")).toBe("act");
    expect(status("coming:low-sav")).toBe("good");
    expect(status("budgets:Food and drink")).toBe("act");
    expect(status("budgets:Shopping")).toBe("good");
    expect(status("subscriptions:merchant:hulu")).toBe("look");
    expect(status("spending:up-Food and drink")).toBe("look");
    expect(status("books:b1")).toBe("look");
    expect(status("transfers:t1")).toBe("look");
    expect(allItems(FULL).some((i) => i.id.endsWith("not_on_the_map"))).toBe(false);
  });

  it("gives each node its figure", () => {
    const figure = (id: string) => allItems(FULL).find((i) => i.id === id)?.figure;
    expect(figure("charges:bill_negotiation")).toBe("$240/yr");
    expect(figure("coming:low-chk")).toBe("$40");
    expect(figure("coming:week")).toBe("$1.5k");
    expect(figure("budgets:Food and drink")).toBe("$40 over");
    expect(figure("budgets:Shopping")).toBe("$150 left");
    expect(figure("yearly:merchant:geico")).toBe("$85/mo");
    expect(figure("spending:up-Food and drink")).toBe("+$180");
    expect(figure("have:net-worth")).toBe("$48k");
    expect(figure("have:goals")).toBe("2 of 3");
    const labels = allItems(FULL).map((i) => i.label);
    expect(labels).toContain("An import that ended");
    expect(labels).toContain("To Savings");
  });

  it("puts at most three urgent chips up, the biggest first", () => {
    const { chips } = moneyTree(FULL);
    expect(chips.length).toBeLessThanOrEqual(CHIPS_MAX);
    // The $60 under the cushion, the $40 over budget, then Netflix's $36 a year.
    expect(chips.map((c) => c.id)).toEqual([
      "coming:low-chk",
      "budgets:Food and drink",
      "charges:price_increase",
    ]);
  });

  it("says all good when nothing needs a look", () => {
    const area = moneyTree(EMPTY);
    expect(area.tree.sub).toBe("All good");
    expect(area.chips).toEqual([]);
    expect(allItems(EMPTY).map((i) => i.label)).toContain("Set a monthly budget");
  });

  it("shows only the reference branches before a bank is linked", () => {
    const none = moneyTree({ ...EMPTY, hasAccounts: false });
    expect(none.tree.branches.map((b) => b.id)).toEqual(["have"]);
  });

  it("lists each books problem itself, not the suggestion about them", () => {
    const withBoth = {
      ...FULL,
      suggestions: [
        {
          id: "s9",
          topic: "data_problems",
          summary: "Some data doesn't add up.",
          worthCents: 0,
          urgency: "soon",
        },
      ],
    };
    expect(
      moneyTree(withBoth)
        .tree.branches.find((b) => b.id === "books")
        ?.items.map((i) => i.id),
    ).toEqual(["books:b1"]);
  });
});
