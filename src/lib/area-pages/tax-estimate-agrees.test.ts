import { describe, expect, it } from "vitest";
import { tilesView, type AreasInput } from "@/lib/hub/view";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// Gate B, debugger 11-16 (a Plaid sandbox student with no pay, only $0.84 of interest): Home's
// Taxes tile said "Not enough to estimate yet" and the Taxes page's "Your 2026 estimate" said
// "$0 back", marked good. The same estimate now reads the same on both (estimateState).

type Estimate = {
  totalTaxCents: number;
  paidCents: number;
  refundCents: number;
  withholdingKnown: boolean;
  incomeCents: number;
};

const home = (t: Estimate) => {
  const input = {
    parts: [],
    suggestions: [],
    safeShort: false,
    money: null,
    insurance: null,
    loans: null,
    taxes: t,
    investments: null,
    ahead: null,
  } as unknown as AreasInput;
  return tilesView(input).find((x) => x.key === "taxes")!;
};

const page = (t: Estimate) => {
  const input: TaxesTreeInput = {
    asOf: "2026-11-16",
    year: 2026,
    moves: [],
    savings: null,
    estimate: {
      refundCents: t.refundCents,
      withholdingKnown: t.withholdingKnown,
      totalTaxCents: t.totalTaxCents,
      incomeCents: t.incomeCents,
    },
    setAside: { status: "unknown", advice: false, holdCents: 0, percent: 0 },
    withholding: "unknown",
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
  };
  const { tree, summaries } = taxesTree(input);
  const item = tree.branches.flatMap((b) => b.items).find((i) => i.id === "estimate:estimate")!;
  return { figure: item.figure, summary: summaries["estimate:estimate"]! };
};

describe("this year's tax estimate, on Home and on Taxes", () => {
  it("says there's nothing to estimate yet on both, with no pay", () => {
    const t = {
      totalTaxCents: 0,
      paidCents: 0,
      refundCents: 0,
      withholdingKnown: true,
      incomeCents: 84,
    };
    expect(home(t).caption).toBe("Not enough to estimate yet");
    expect(page(t).figure).toBeUndefined();
    expect(page(t).summary).toMatch(/^Not enough to estimate yet/);
  });

  it("says no tax on both, for pay under what's taxed", () => {
    const t = {
      totalTaxCents: 0,
      paidCents: 0,
      refundCents: 0,
      withholdingKnown: false,
      incomeCents: 900_000,
    };
    expect(home(t).caption).toBe("No income tax expected");
    expect(page(t).figure).toBe("No tax");
  });

  it("gives the same refund on both", () => {
    const t = {
      totalTaxCents: 400_000,
      paidCents: 520_000,
      refundCents: 120_000,
      withholdingKnown: true,
      incomeCents: 4_000_000,
    };
    expect(home(t).caption).toBe("Refund, estimated");
    expect(home(t).value).toBe("+$1.2k");
    expect(page(t).figure).toBe("$1.2k back");
  });
});
