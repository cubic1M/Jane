import { describe, expect, it } from "vitest";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// CodeRabbit sweep part 4: the loss-harvest card ("save $960 a year") opens Investments on Taxes,
// whose item said only "Gains and losses from the cost basis your broker reports": a card whose
// figure is not on the page it opens. The item now says the card's own figure.

const input = (over: Partial<TaxesTreeInput> = {}): TaxesTreeInput => ({
  asOf: "2026-11-12",
  year: 2026,
  moves: [],
  savings: [],
  estimate: { refundCents: 0, withholdingKnown: false },
  setAside: { status: "unknown", advice: false, holdCents: 0, percent: 0 },
  withholding: "unknown",
  w4Sent: false,
  refunds: 0,
  investments: { washSales: 0, harvest: 1 },
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
      topic: "tax_loss_harvest",
      summary: "A taxable account holds $3,980.00 less than you paid for it.",
      worthCents: 96_000,
      worthKind: "saves",
      headline: "Sell a holding at a loss, save $960 a year",
      urgency: "soon",
      actionHref: "/taxes?focus=estimate:investments",
    },
  ],
  ...over,
});

const built = (over: Partial<TaxesTreeInput> = {}) => taxesTree(input(over));
const item = (t: ReturnType<typeof taxesTree>) =>
  t.tree.branches.flatMap((b) => b.items).find((i) => i.id === "estimate:investments")!;
const said = (t: ReturnType<typeof taxesTree>) => t.summaries["estimate:investments"] ?? "";

describe("the Investments item says the harvest card's figure", () => {
  it("says $960 where the card says $960", () => {
    expect(item(built()).figure).toBe("$960/yr");
    expect(said(built())).toContain("$960");
  });

  it("says nothing of it without losses to harvest, or without the card", () => {
    expect(said(built({ investments: { washSales: 0, harvest: 0 } }))).not.toContain("$960");
    expect(said(built({ suggestions: [] }))).not.toContain("$960");
  });

  it("keeps a wash sale as the figure and still says the saving in words", () => {
    const t = built({ investments: { washSales: 1, harvest: 1 } });
    expect(item(t).figure).toBe("1 wash sale");
    expect(said(t)).toContain("$960");
  });
});
