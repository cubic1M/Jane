import { describe, expect, it } from "vitest";
import { TAXES_ANCHORS, taxesTree, type TaxesTreeInput } from "./taxes";
import { LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// The Taxes page as a tree (docs/design/area-pages.md): few words per node, the status of a
// branch from its items, at most three urgent chips, and the old #anchors still landing.

const input = (over: Partial<TaxesTreeInput> = {}): TaxesTreeInput => ({
  asOf: "2026-10-23",
  year: 2026,
  moves: [
    {
      id: "2026:estimated_4",
      key: "estimated_4",
      detail: "Your fourth estimated payment for 2026.",
      deadline: "2026-11-01",
      opensOn: "2026-10-01",
      handled: null,
      amountCents: 120_000,
    },
    {
      id: "2026:workplace_retirement",
      key: "workplace_retirement",
      detail:
        "Raise what goes into your 401(k) before the year ends. Each dollar lowers this year's tax. Your plan allows more than you put in.",
      deadline: "2026-12-31",
      opensOn: "2026-10-01",
      handled: null,
      amountCents: 500_000,
    },
    {
      id: "2026:file",
      key: "file",
      detail: "File your 2026 return.",
      deadline: "2027-04-15",
      opensOn: "2027-01-15",
      handled: null,
      amountCents: null,
    },
  ],
  savings: [
    {
      key: "retirement",
      title: "Put about $150 more a paycheck into your 401(k)",
      estimateCents: 132_000,
    },
  ],
  estimate: { refundCents: 81_200, withholdingKnown: true },
  withholding: "big_refund",
  w4Sent: false,
  refunds: 0,
  investments: { washSales: 1, harvest: 0 },
  forms: { total: 3, received: 1, toCheck: 0 },
  tags: { checks: 2 },
  records: { items: 4, needs: 0, gaps: 0, canGo: 0 },
  sideIncome: null,
  home: true,
  family: { choices: 1 },
  giving: { totalCents: 45_000, receiptsMissing: 0, options: 0 },
  profile: {
    complete: false,
    newIncome: 0,
    fields: [
      { key: "filing", label: "How you file", value: "Single", status: "found" },
      { key: "state", label: "State", value: "California", status: "yours" },
    ],
  },
  ...over,
});

describe("the taxes tree", () => {
  it("keeps every node to six words and every summary to two sentences", () => {
    const { tree, summaries } = taxesTree(input());
    const labels = [
      tree.label,
      ...tree.branches.flatMap((b) => [b.label, ...b.items.map((i) => i.label)]),
    ];
    for (const l of labels) expect(words(l), l).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const [id, s] of Object.entries(summaries))
      expect(sentences(s), id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    expect(summaries["savings:retirement"]).toBe(
      "Put about $150 more a paycheck into your 401(k).",
    );
    // A long move is cut to its first two sentences; the rest goes behind More.
    expect(summaries["soon:2026:workplace_retirement"]).toBe(
      "Raise what goes into your 401(k) before the year ends. Each dollar lowers this year's tax.",
    );
  });

  it("shows the branches with something in them, what's due first", () => {
    const { tree } = taxesTree(input());
    expect(tree.branches.map((b) => b.id)).toEqual([
      "soon",
      "savings",
      "estimate",
      "records",
      "life",
      "profile",
      "filing",
      "topics",
    ]);
    // Without demo advice there are no savings to show.
    expect(taxesTree(input({ savings: null })).tree.branches.map((b) => b.id)).not.toContain(
      "savings",
    );
  });

  it("marks each item by how pressing it is", () => {
    const { tree } = taxesTree(input());
    const branch = (id: string) => tree.branches.find((b) => b.id === id)!;
    // Due within two weeks is urgent; open with time left is a look; not open yet is fine.
    expect(branch("soon").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Fourth estimated payment", "act", "by Nov 1"],
      ["Add to your 401(k)", "look", "by Dec 31"],
      ["File your return", "good", "by Apr 15"],
    ]);
    expect(branch("estimate").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Your 2026 estimate", "good", "$812 back"],
      ["Withholding", "look", "Too much"],
      ["Investments", "look", "1 wash sale"],
    ]);
    expect(branch("records").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["Forms to expect", "good", "1 of 3 in"],
      ["Tagged for 2026", "look", "2 to check"],
      ["Audit-ready records", "good", "4 items"],
    ]);
    expect(branch("profile").items.map((i) => [i.label, i.status, i.figure])).toEqual([
      ["How you file", "look", "Check it"],
      ["State", "good", undefined],
    ]);
    expect(tree.sub).toBe("1 urgent · 7 to look at");
  });

  it("lifts urgent items to the top, at most three, biggest dollars first", () => {
    const moves = ["estimated_1", "estimated_2", "estimated_3", "estimated_4"].map((key, n) => ({
      id: `2026:${key}`,
      key: key as "estimated_1",
      detail: "An estimated payment.",
      deadline: "2026-10-30",
      opensOn: "2026-10-01",
      handled: null,
      amountCents: (n + 1) * 10_000,
    }));
    const { chips } = taxesTree(input({ moves }));
    expect(chips.map((c) => c.id)).toEqual([
      "soon:2026:estimated_4",
      "soon:2026:estimated_3",
      "soon:2026:estimated_2",
    ]);
    expect(chips[0]).toEqual({
      id: "soon:2026:estimated_4",
      label: "Fourth estimated payment",
      figure: "by Oct 30",
    });
  });

  it("is all good with nothing to do", () => {
    const { tree, chips } = taxesTree(
      input({
        moves: [],
        savings: [],
        withholding: "on_track",
        investments: null,
        tags: { checks: 0 },
        family: null,
        profile: {
          complete: true,
          newIncome: 0,
          fields: [{ key: "state", label: "State", value: "California", status: "yours" }],
        },
      }),
    );
    expect(chips).toEqual([]);
    expect(tree.sub).toBe("All good");
  });

  it("opens the item each old #anchor named", () => {
    const { tree } = taxesTree(input({ refunds: 1, sideIncome: { differs: 0, waiting: 1 } }));
    const ids = new Set(tree.branches.flatMap((b) => [b.id, ...b.items.map((i) => i.id)]));
    for (const [anchor, id] of Object.entries(TAXES_ANCHORS)) expect(ids, anchor).toContain(id);
  });
});
