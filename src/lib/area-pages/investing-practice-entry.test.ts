import { describe, expect, it } from "vitest";
import { investingTree, type InvestingTreeInput } from "./investing";

// Debugger 11-15: a student who only uploaded a checking statement opened Investing, tapped the
// tree's "Practice portfolio", and its page said "The practice portfolio is only available in
// demo advice mode for now." The Investments page already says, above the tree, that Jane can run
// one on made-up money, with a link to see it on sample data. Without demo advice the tree has no
// practice node leading to that dead end; with it, the practice portfolio is in the tree as before.

const input = (practice: InvestingTreeInput["practice"]): InvestingTreeInput => ({
  suggestions: [],
  accounts: [],
  totalCents: 0,
  byType: 0,
  cryptoCents: 0,
  profile: { complete: false, label: null },
  returns: { periods: 0 },
  months: false,
  practice,
});

const ids = (practice: InvestingTreeInput["practice"]) =>
  investingTree(input(practice)).tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("the practice portfolio on the investing tree", () => {
  it("isn't a node for someone it isn't open to", () => {
    expect(ids(null)).not.toContain("practice:portfolio");
  });

  it("is a node in demo advice, started or not", () => {
    expect(ids({ started: false, ideas: [], strategy: null })).toContain("practice:portfolio");
    expect(ids({ started: true, ideas: [], strategy: null })).toContain("practice:portfolio");
  });
});
