import { describe, expect, it } from "vitest";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// Debugger 11-19 (r362, upload S6 on a phone: 14 months of Wells Fargo checking with an $842 IRS
// refund in March): Taxes → Pay less tax read "Check your withholding: last refund $842 · $842",
// the refund said twice on one line. The item is named for what to do; the figure says the refund.

const input: TaxesTreeInput = {
  asOf: "2026-11-19",
  year: 2026,
  moves: [],
  savings: [],
  estimate: { refundCents: 0, withholdingKnown: false },
  setAside: { status: "unknown", advice: false, holdCents: 0, percent: 0 },
  withholding: "unknown",
  w4Sent: false,
  refunds: 1,
  investments: null,
  forms: { total: 0, received: 0, toCheck: 0 },
  tags: { checks: 0 },
  records: { items: 0, needs: 0, gaps: 0, canGo: 0 },
  sideIncome: null,
  home: false,
  family: null,
  giving: null,
  profile: { complete: false, newIncome: 0, fields: [] },
  suggestions: [
    {
      topic: "refund_withholding",
      summary: "A $842.00 IRS refund on Mar 18 beside your pay: about $70.17 a month.",
      headline: "Check your withholding: last refund $842",
      worthCents: 84_200,
      worthKind: "earns",
      urgency: "soon",
      status: "selected",
      actionHref: "/taxes",
    },
  ],
};

describe("the withholding suggestion on Taxes", () => {
  it("says the refund once, as its figure", () => {
    const item = taxesTree(input)
      .tree.branches.flatMap((b) => b.items)
      .find((i) => i.id.endsWith("suggestion:refund_withholding"));
    expect(item).toMatchObject({ label: "Check your withholding", figure: "$842" });
  });
});
