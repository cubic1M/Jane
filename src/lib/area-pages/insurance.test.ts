import { describe, expect, it } from "vitest";
import { insuranceTree, type InsuranceTreeInput } from "./insurance";
import {
  LABEL_MAX_WORDS,
  SUMMARY_MAX_SENTENCES,
  firstSentences,
  sentences,
  words,
  worst,
} from "./tree";

// The Insurance page as a tree (docs/design/area-pages.md): few words per node, the status of
// a branch from its items, and at most three urgent chips with their dollar figure.

const input = (over: Partial<InsuranceTreeInput> = {}): InsuranceTreeInput => ({
  asOf: "2026-10-23",
  needs: [
    {
      kind: "life",
      policyId: null,
      gapCents: 120_000_000,
      haveCents: 0,
      needCents: 120_000_000,
      unit: "total",
      summary: "Your family relies on your pay of $80,000 a year.",
      opened: false,
    },
    {
      kind: "auto_liability",
      policyId: "p1",
      gapCents: 0,
      haveCents: 10_000_000,
      needCents: 10_000_000,
      unit: "total",
      summary: "Your car's injury liability covers what you own.",
      opened: false,
    },
  ],
  policies: [
    {
      id: "p1",
      kind: "auto",
      carrier: "GEICO",
      status: "active",
      yearlyCents: 170_400,
      renewsOn: "2027-03-01",
    },
    {
      id: "p2",
      kind: "renters",
      carrier: "Lemonade",
      status: "active",
      yearlyCents: 14_400,
      renewsOn: "2026-11-10",
    },
  ],
  gaps: [
    {
      key: "home",
      why: "You own your home. A fire or a flood could cost far more than your savings. Lenders usually require it.",
      policyId: null,
    },
  ],
  savings: [
    {
      id: "s1",
      kind: "autopay",
      yearlySavingCents: 5_112,
      line: "Turn on autopay for your GEICO car policy: about $51.12 a year less",
    },
  ],
  renewals: [
    {
      id: "n1",
      carrier: "GEICO",
      status: "asked",
      currentAnnualCents: 150_000,
      renewalAnnualCents: 170_400,
      line: "Your car policy renews higher.",
    },
  ],
  changes: [],
  readings: [],
  payingTwice: [
    { findingId: "f1", merchant: "Asurion", card: "Demo Credit Card", annualSavingsCents: 20_400 },
  ],
  cards: [{ accountId: "a1", card: "Demo Credit Card", benefits: 3 }],
  household: [
    { name: "You", policies: 2 },
    { name: "Sam", policies: 0 },
  ],
  risks: [
    {
      id: "r1",
      kind: "rideshare",
      question:
        "Are you driving for Uber? I saw $412.00 come in from Uber Driver. A personal car policy may not cover you while you drive for pay.",
    },
  ],
  health: null,
  ...over,
});

describe("the copy budget", () => {
  it("counts words and sentences", () => {
    expect(words("Pay the year up front")).toBe(5);
    expect(sentences("One. Two $5. Three.")).toBe(3);
    expect(sentences("It costs $1.50 a month.")).toBe(1);
    expect(firstSentences("One. Two. Three.")).toBe("One. Two.");
  });

  it("keeps every node to six words and every summary to two sentences", () => {
    const { tree, summaries } = insuranceTree(input());
    const labels = [
      tree.label,
      ...tree.branches.flatMap((b) => [b.label, ...b.items.map((i) => i.label)]),
    ];
    for (const l of labels) expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const [id, s] of Object.entries(summaries)) {
      expect(sentences(s), id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    }
    // A long reason is cut to its first two sentences; the rest goes behind More.
    expect(summaries["missing:home"]).toBe(
      "You own your home. A fire or a flood could cost far more than your savings.",
    );
    expect(summaries["questions:r1"]).toBe(
      "Are you driving for Uber? I saw $412.00 come in from Uber Driver.",
    );
  });
});

describe("the insurance tree", () => {
  it("shows only the branches with something in them, most pressing first", () => {
    const { tree } = insuranceTree(input());
    expect(tree.branches.map((b) => b.id)).toEqual([
      "needs",
      "missing",
      "renewals",
      "savings",
      "cards",
      "policies",
      "questions",
      "household",
    ]);
  });

  it("marks each item and its branch by how pressing it is", () => {
    const { tree } = insuranceTree(input());
    const branch = (id: string) => tree.branches.find((b) => b.id === id)!;
    expect(branch("missing")).toMatchObject({ status: "act", line: "1 urgent" });
    expect(branch("needs").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Life cover", "look", "$1.2M short"],
      ["Car injury liability", "good", "Covered"],
    ]);
    // A renewal within the next few weeks is worth a look.
    expect(branch("policies").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["GEICO car", "good", "$1.7k/yr"],
      ["Lemonade renters", "look", "$144/yr"],
    ]);
    expect(branch("household").items.find((i) => i.label === "Sam")).toMatchObject({
      status: "look",
      figure: "None",
    });
    expect(tree.sub).toBe("3 urgent · 5 to look at");
  });

  // Overnight upload QA: every salaried person's tree led with "Health cover: Missing" and
  // "Disability cover: Missing", both urgent, though a job usually covers both out of pay.
  it("says cover a job usually gives is not on file, worth a look", () => {
    const { tree } = insuranceTree(
      input({
        gaps: [
          { key: "health", why: "There's no health plan on your profile.", policyId: null },
          { key: "disability", why: "Nothing would replace your pay.", policyId: null },
          ...input().gaps,
        ],
      }),
    );
    const missing = tree.branches.find((b) => b.id === "missing")!;
    expect(missing.items.map((i) => [i.label, i.status, i.figure])).toEqual([
      [expect.any(String), "look", "Not on file"],
      [expect.any(String), "look", "Not on file"],
      ["Home insurance", "act", "Missing"],
    ]);
  });

  it("lifts at most three urgent items to the top, biggest dollars first", () => {
    const { chips } = insuranceTree(input());
    expect(chips).toEqual([
      // A tie keeps the branches' order.
      { id: "renewals:n1", label: "GEICO renewal", figure: "+$204/yr" },
      { id: "cards:twice-f1", label: "Paying twice: Asurion", figure: "$204/yr" },
      { id: "missing:home", label: "Home insurance", figure: "Missing" },
    ]);
  });

  it("is all good with nothing to do", () => {
    const { tree, chips } = insuranceTree(
      input({
        needs: [],
        gaps: [],
        savings: [],
        renewals: [],
        payingTwice: [],
        risks: [],
        household: [],
      }),
    );
    expect(chips).toEqual([]);
    expect(tree.sub).toBe("1 to look at");
    expect(worst(["good", "look", undefined])).toBe("look");
  });
});
