import { describe, expect, it } from "vitest";
import { taxesTree, type TaxesTreeInput } from "./taxes";
import { LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// The tax left to cover in the Taxes tree: short words, one figure, detail on a tap.

const input = (setAside: TaxesTreeInput["setAside"]): TaxesTreeInput => ({
  asOf: "2026-11-04",
  year: 2026,
  moves: [],
  savings: null,
  estimate: { refundCents: 0, withholdingKnown: true },
  setAside,
  withholding: "on_track",
  w4Sent: false,
  refunds: 0,
  investments: null,
  forms: { total: 0, received: 0, toCheck: 0 },
  tags: { checks: 0 },
  records: { items: 0, needs: 0, gaps: 0, canGo: 0 },
  sideIncome: null,
  home: false,
  family: null,
  giving: null,
  profile: { complete: true, newIncome: 0, fields: [] },
});

const node = (setAside: TaxesTreeInput["setAside"]) => {
  const { tree, summaries } = taxesTree(input(setAside));
  const items = tree.branches.flatMap((b) => b.items);
  const item = items.find((i) => i.id === "estimate:set-aside");
  return { item, summary: summaries["estimate:set-aside"] };
};
const FIGURE = { advice: false, holdCents: 410_000, percent: 72 };

describe("the tax left to cover in the tree", () => {
  // Debugger 11-05: "That isn't income" on someone's only income took away the one place to undo it.
  it("stays while there's something pointed out to undo, whatever the income", () => {
    const { item, summary } = node({
      status: "no_income",
      ...FIGURE,
      holdCents: 0,
      corrections: 1,
    });
    expect(item?.label).toBe("Tax not yet paid");
    expect(item?.status).toBe("look");
    expect(item?.figure).toBe("No income");
    expect(summary).toContain("what you pointed out");
  });

  it("has the figure and a short label, within the budgets", () => {
    const { item, summary } = node({ status: "needed", ...FIGURE });
    expect(item?.label).toBe("Tax not yet paid");
    expect(item?.status).toBe("look");
    expect(words(item?.label ?? "")).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    expect(sentences(summary ?? "")).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    expect(summary).toContain("72% sure");
  });

  it("says set aside only in demo advice", () => {
    expect(node({ status: "needed", ...FIGURE, advice: true }).item?.label).toBe(
      "Left to set aside",
    );
  });

  it("an unknown reads as not known, never $0", () => {
    const { item } = node({ status: "unknown", ...FIGURE, holdCents: 0 });
    expect(item?.status).toBe("look");
    expect(JSON.stringify(item)).toContain("Not known");
  });

  it("covered is good, and no income isn't drawn", () => {
    expect(node({ status: "covered", ...FIGURE, holdCents: 0 }).item?.status).toBe("good");
    expect(node({ status: "no_income", ...FIGURE, holdCents: 0 }).item).toBeUndefined();
  });
});
