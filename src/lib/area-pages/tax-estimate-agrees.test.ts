import { describe, expect, it } from "vitest";
import { tilesView, type AreasInput } from "@/lib/hub/view";
import { homeTaxes } from "@/planning/home-taxes";
import { estimateTaxes } from "@/planning/tax-estimate";
import { inputOf } from "@/tax-bench/serialize";
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

// Tax T6: the same loan reads the same in the estimate's itemized deduction and in the Taxes page's
// home section (a $1,000,000 loan with $40,000 of interest: 750,000 / 1,000,000 of it, $30,000, on
// both; 26 USC 163(h)(3)(F)(i)(II), Publication 936 (2025)).
describe("mortgage interest, in the estimate and in the home section", () => {
  const loan = { interest: 4_000_000, balance: 100_000_000 };

  it("counts $30,000 of $40,000 on a $1,000,000 loan on both", () => {
    const estimate = estimateTaxes(
      inputOf(
        2026,
        "single",
        { wagesCents: 30_000_000 },
        { mortgageInterestCents: loan.interest, mortgageBalanceCents: loan.balance },
      ),
    );
    const section = homeTaxes({
      year: 2026,
      status: "single",
      agiCents: estimate.agiCents,
      mortgage: {
        name: "Home loan",
        ytdInterestCents: loan.interest,
        balanceCents: loan.balance,
        form1098: null,
      },
      propertyTax: [],
      stateIncomeTaxCents: 0,
      points: null,
      homeOfficeSqFt: null,
      energy: [],
      sale: null,
    });
    expect(estimate.deduction.itemized.mortgageInterestCents).toBe(3_000_000);
    expect(section.mortgageInterest!.cents).toBe(3_000_000);
  });
});
