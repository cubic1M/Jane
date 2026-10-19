import { describe, expect, it } from "vitest";
import { FEDERAL_BRACKETS, STANDARD_DEDUCTION, STATE_TAX } from "@/config/tax-rates";
import {
  NO_INCOME,
  bracketTax,
  childCredits,
  earnedIncomeCredit,
  estimateTaxes,
  incomeTax,
  selfEmploymentTax,
  type EstimateInput,
} from "./tax-estimate";

// Spec step 120: the 2026 figures in src/config/tax-rates.ts, checked against what the IRS
// publishes, and the estimate built from them.

const $ = (dollars: number) => Math.round(dollars * 100);

describe("2026 federal brackets, against Rev. Proc. 2025-32's tables", () => {
  // Each published row reads "$X plus N% of the excess over $Y": tax at the start of each
  // bracket must equal $X.
  it.each([
    ["single", 12_400, 1_240],
    ["single", 50_400, 5_800],
    ["single", 105_700, 17_966],
    ["single", 201_775, 41_024],
    ["single", 256_225, 58_448],
    ["single", 640_600, 192_979.25],
    ["married_joint", 24_800, 2_480],
    ["married_joint", 100_800, 11_600],
    ["married_joint", 211_400, 35_932],
    ["married_joint", 403_550, 82_048],
    ["married_joint", 512_450, 116_896],
    ["married_joint", 768_700, 206_583.5],
    ["married_separate", 384_350, 103_291.75],
    ["head_of_household", 17_700, 1_770],
    ["head_of_household", 67_450, 7_740],
  ] as const)("%s at $%d is $%d", (status, income, tax) => {
    expect(bracketTax($(income), FEDERAL_BRACKETS[status])).toBe($(tax));
  });

  it("has the published standard deductions", () => {
    expect(STANDARD_DEDUCTION).toEqual({
      single: $(16_100),
      married_joint: $(32_200),
      married_separate: $(16_100),
      head_of_household: $(24_150),
    });
  });

  it("taxes qualified dividends and long-term gains at 0% inside the 0% band", () => {
    // $40,000 taxable, $10,000 of it qualified dividends: $30,000 ordinary, the rest at 0%.
    expect(incomeTax($(40_000), $(10_000), "single")).toBe(
      bracketTax($(30_000), FEDERAL_BRACKETS.single),
    );
    // Above the band, 15%.
    const tax = incomeTax($(100_000), $(10_000), "single");
    expect(tax).toBe(bracketTax($(90_000), FEDERAL_BRACKETS.single) + $(1_500));
  });
});

describe("self-employment tax (Schedule SE)", () => {
  it("is 15.3% of 92.35% of net earnings", () => {
    expect(selfEmploymentTax($(50_000), 0)).toBe($(7_064.78));
  });

  it("stops Social Security at the $184,500 wage base, counting W-2 wages first", () => {
    // $180,000 of wages leaves $4,500 of base for Social Security.
    expect(selfEmploymentTax($(50_000), $(180_000))).toBe(
      Math.round($(4_500) * 0.124 + $(50_000) * 0.9235 * 0.029),
    );
  });

  it("is nothing under $400 of net earnings", () => {
    expect(selfEmploymentTax($(400), 0)).toBe(0);
  });
});

describe("child tax credit", () => {
  it("is $2,200 a child, cut $50 per $1,000 over $200,000 ($400,000 joint)", () => {
    const base = { others: 0, earnedCents: $(300_000), taxBeforeCreditsCents: $(50_000) };
    expect(
      childCredits({ ...base, status: "single", children: 2, agiCents: $(150_000) }).childCents,
    ).toBe($(4_400));
    // $10,001 over: 11 steps of $50.
    expect(
      childCredits({ ...base, status: "single", children: 2, agiCents: $(210_001) }).childCents,
    ).toBe($(4_400 - 550));
    expect(
      childCredits({ ...base, status: "married_joint", children: 2, agiCents: $(210_001) })
        .childCents,
    ).toBe($(4_400));
  });

  it("refunds up to $1,700 a child of what the tax didn't use, from 15% of earnings over $2,500", () => {
    const low = childCredits({
      status: "head_of_household",
      children: 2,
      others: 0,
      agiCents: $(30_000),
      earnedCents: $(30_000),
      taxBeforeCreditsCents: $(500),
    });
    expect(low.childCents).toBe($(500));
    expect(low.refundableCents).toBe($(3_400));
    const tiny = childCredits({
      status: "single",
      children: 1,
      others: 0,
      agiCents: $(6_500),
      earnedCents: $(6_500),
      taxBeforeCreditsCents: 0,
    });
    expect(tiny.refundableCents).toBe($(600));
  });

  it("gives $500 for other dependants, not refundable", () => {
    const c = childCredits({
      status: "single",
      children: 0,
      others: 1,
      agiCents: $(40_000),
      earnedCents: $(40_000),
      taxBeforeCreditsCents: $(300),
    });
    expect(c).toEqual({ childCents: 0, otherCents: $(300), refundableCents: 0 });
  });
});

describe("earned income credit", () => {
  it("reaches the published maximum on the plateau", () => {
    const at = (children: number, earned: number) =>
      earnedIncomeCredit({
        status: "single",
        children,
        earnedCents: $(earned),
        agiCents: $(earned),
        investmentIncomeCents: 0,
      });
    expect(at(0, 9_000)).toBe($(664));
    expect(at(1, 15_000)).toBe($(4_427));
    expect(at(2, 20_000)).toBe($(7_316));
    expect(at(3, 20_000)).toBe($(8_231));
    // Gone at the published end of the phase-out.
    expect(at(1, 51_593)).toBeLessThanOrEqual(100);
    expect(at(1, 52_000)).toBe(0);
  });

  it("isn't for married filing separately or with too much investment income", () => {
    const base = { children: 1, earnedCents: $(15_000), agiCents: $(15_000) };
    expect(
      earnedIncomeCredit({ ...base, status: "married_separate", investmentIncomeCents: 0 }),
    ).toBe(0);
    expect(
      earnedIncomeCredit({ ...base, status: "single", investmentIncomeCents: $(20_000) }),
    ).toBe(0);
  });
});

const input = (o: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, wagesCents: $(85_632), socialSecurityWagesCents: $(91_320) },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: $(13_573.68),
  federalEstimatedPaidCents: 0,
  stateWithheldCents: $(5_040),
  stateEstimatedPaidCents: 0,
  ...o,
});

describe("the estimate", () => {
  it("a single person on wages: standard deduction, brackets, withholding", () => {
    const e = estimateTaxes(input());
    expect(e.agiCents).toBe($(85_632));
    expect(e.deduction).toMatchObject({ kind: "standard", standardCents: $(16_100) });
    expect(e.taxableCents).toBe($(69_532));
    // $5,800 + 22% of ($69,532 − $50,400).
    expect(e.incomeTaxCents).toBe($(10_009.04));
    expect(e.totalTaxCents).toBe($(10_009.04));
    expect(e.refundCents).toBe($(13_573.68 - 10_009.04));
    expect(e.marginalRate).toBe(0.22);
  });

  it("married with two children: joint brackets and the child tax credit", () => {
    const e = estimateTaxes(input({ filingStatus: "married_joint", childrenUnder17: 2 }));
    expect(e.taxableCents).toBe($(85_632 - 32_200));
    // $2,480 + 12% of ($53,432 − $24,800) = $5,915.84, less $4,400.
    expect(e.incomeTaxCents).toBe($(5_915.84));
    expect(e.credits.childTaxCreditCents).toBe($(4_400));
    expect(e.totalTaxCents).toBe($(1_515.84));
  });

  it("itemizes when it's more than the standard deduction, with the SALT cap and floors", () => {
    const e = estimateTaxes(
      input({
        mortgageInterestCents: $(10_230.4),
        charityCents: $(1_000),
        stateWithheldCents: $(5_040),
        otherStateLocalTaxCents: $(6_000),
        medicalCents: $(1_000),
      }),
    );
    expect(e.deduction.kind).toBe("itemized");
    expect(e.deduction.itemized).toEqual({
      stateLocalTaxCents: $(11_040),
      mortgageInterestCents: $(10_230.4),
      // Gifts above 0.5% of AGI ($428.16).
      charityCents: $(1_000 - 428.16),
      // Medical only above 7.5% of AGI.
      medicalCents: 0,
    });
  });

  it("lets non-itemizers deduct cash gifts up to $1,000", () => {
    expect(estimateTaxes(input({ charityCents: $(1_500) })).deduction.nonItemizerCharityCents).toBe(
      $(1_000),
    );
    expect(
      estimateTaxes(input({ filingStatus: "married_joint", charityCents: $(1_500) })).deduction
        .nonItemizerCharityCents,
    ).toBe($(1_500));
  });

  it("freelance income: self-employment tax, half deducted, and the QBI deduction", () => {
    const e = estimateTaxes(
      input({
        income: { ...NO_INCOME, selfEmploymentCents: $(60_000) },
        federalWithheldCents: 0,
        stateWithheldCents: 0,
      }),
    );
    const seTax = selfEmploymentTax($(60_000), 0);
    expect(e.selfEmploymentTaxCents).toBe(seTax);
    expect(e.adjustments.halfSelfEmploymentTaxCents).toBe(Math.round(seTax / 2));
    expect(e.qbiCents).toBeGreaterThan(0);
    expect(e.refundCents).toBeLessThan(0);
  });

  it("phases out student loan interest by income", () => {
    const at = (wages: number) =>
      estimateTaxes(
        input({
          income: { ...NO_INCOME, wagesCents: $(wages) },
          studentLoanInterestCents: $(805.5),
        }),
      ).adjustments.studentLoanInterestCents;
    expect(at(80_000)).toBe($(805.5));
    // A tenth of the way through the $85,000–$100,000 range.
    expect(at(86_500)).toBe(Math.round($(805.5) * 0.9));
    expect(at(120_000)).toBe(0);
  });
});

describe("state estimates", () => {
  it("no tax in Texas, a flat rate in Illinois", () => {
    expect(estimateTaxes(input({ state: "TX" })).state).toMatchObject({
      taxCents: 0,
      kind: "none",
    });
    expect(estimateTaxes(input({ state: "IL" })).state).toMatchObject({
      kind: "flat",
      taxCents: Math.round($(85_632) * 0.0495),
    });
  });

  it("California brackets less the exemption credit, marked as not confirmed for 2026", () => {
    const state = estimateTaxes(input({ state: "CA" })).state!;
    expect(state.taxableCents).toBe($(85_632 - 5_706));
    expect(state.taxCents).toBe(
      bracketTax(
        $(85_632 - 5_706),
        (STATE_TAX.CA as { brackets: typeof FEDERAL_BRACKETS }).brackets.single,
      ) - $(153),
    );
    expect(state.rough).toBe(true);
    expect(state.refundCents).toBe($(5_040) - state.taxCents);
  });

  it("a rough rate where Jane doesn't have the state's brackets", () => {
    expect(estimateTaxes(input({ state: "OR" })).state).toMatchObject({
      kind: "approximate",
      rough: true,
    });
    expect(estimateTaxes(input({ state: null })).state).toBeNull();
  });

  it("every state and DC has rules", () => {
    expect(Object.keys(STATE_TAX)).toHaveLength(51);
  });
});
