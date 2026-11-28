import { describe, expect, it } from "vitest";
import { lawYearFor, NoTaxParamsError, ownLawYear } from "@/config/tax-params";
import { estimateNote } from "@/planning/tax-estimate-copy";
import { estimateTaxes, NO_INCOME, type EstimateInput } from "@/planning/tax-estimate";
import { federalTaxOf, lawYearOf, standardDeductionOf } from "@/planning/student-tax";

// Tax T4: the estimate prices each year with that year's law and refuses a year it has no law for.
const $ = (dollars: number) => Math.round(dollars * 100);

const household = (year: number, over: Partial<EstimateInput> = {}): EstimateInput => ({
  year,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, wagesCents: $(50_000), socialSecurityWagesCents: $(50_000) },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
  ...over,
});

describe("one household, two tax years", () => {
  // HE-2 (roadmap T3/T4): 2025, single, wages $50,000. Standard $15,750 (Rev. Proc. 2025-32 3.01);
  // taxable $34,250; tax = 10% x $11,925 + 12% x ($34,250 - $11,925) = $1,192.50 + $2,679.00
  // = $3,871.50. The 2026 law (HE-1): standard $16,100, taxable $33,900, tax $3,820.00.
  it("2025 takes the $15,750 standard deduction and 2026 takes $16,100", () => {
    const y25 = estimateTaxes(household(2025));
    const y26 = estimateTaxes(household(2026));
    expect(y25.deduction.standardCents).toBe($(15_750));
    expect(y26.deduction.standardCents).toBe($(16_100));
    expect(y25.taxableCents).toBe($(34_250));
    expect(y26.taxableCents).toBe($(33_900));
  });

  it("HE-2: single, 2025, wages $50,000 owes $3,871.50 of income tax (the bench's figure)", () => {
    expect(estimateTaxes(household(2025)).incomeTaxCents).toBe(387_150);
  });

  it("HE-1: the same person under 2026 law owes $3,820.00", () => {
    expect(estimateTaxes(household(2026)).incomeTaxCents).toBe(382_000);
  });

  it("2025's joint standard deduction is $31,500, 2026's $32,200", () => {
    const joint = (year: number) =>
      estimateTaxes(household(year, { filingStatus: "married_joint" })).deduction.standardCents;
    expect(joint(2025)).toBe($(31_500));
    expect(joint(2026)).toBe($(32_200));
  });

  it("the Social Security wage base of the year caps the self-employment tax", () => {
    // $200,000 of wages already over both years' bases ($176,100 in 2025, $184,500 in 2026): only the
    // 2.9% Medicare part of 92.35% of the $50,000 of net earnings is left to pay.
    const over = {
      income: {
        ...NO_INCOME,
        wagesCents: $(200_000),
        selfEmploymentCents: $(50_000),
        socialSecurityWagesCents: $(200_000),
      },
    };
    const medicare = Math.round($(50_000) * 0.9235 * 0.029);
    expect(estimateTaxes(household(2025, over)).selfEmploymentTaxCents).toBe(medicare);
    expect(estimateTaxes(household(2026, over)).selfEmploymentTaxCents).toBe(medicare);
    // $150,000 of wages: 2025's base ($176,100) leaves $26,100 of room, 2026's ($184,500) $34,500.
    const room = {
      income: {
        ...NO_INCOME,
        wagesCents: $(150_000),
        selfEmploymentCents: $(50_000),
        socialSecurityWagesCents: $(150_000),
      },
    };
    const e25 = estimateTaxes(household(2025, room)).selfEmploymentTaxCents;
    const e26 = estimateTaxes(household(2026, room)).selfEmploymentTaxCents;
    expect(e25).toBe(Math.round($(26_100) * 0.124 + $(50_000) * 0.9235 * 0.029));
    expect(e26).toBe(Math.round($(34_500) * 0.124 + $(50_000) * 0.9235 * 0.029));
  });
});

describe("a year with no IRS figures", () => {
  it("throws NoTaxParamsError for 2024 and for 2028, never a fallback to another year", () => {
    for (const year of [2024, 2028]) {
      expect(() => estimateTaxes(household(year))).toThrow(NoTaxParamsError);
      try {
        estimateTaxes(household(year));
      } catch (error) {
        expect((error as NoTaxParamsError).year).toBe(year);
      }
    }
  });
});

describe("only a forward projection holds the law fixed; a year's own figure never does", () => {
  it("ownLawYear is the year itself or a refusal, never another year's law", () => {
    expect(ownLawYear(2025)).toBe(2025);
    expect(ownLawYear(2026)).toBe(2026);
    expect(ownLawYear(2027)).toBe(2027);
    expect(() => ownLawYear(2028)).toThrow(NoTaxParamsError);
    expect(() => ownLawYear(2024)).toThrow(NoTaxParamsError);
  });

  it("lawYearFor gives the newest year with figures at or before the year, and refuses an earlier one", () => {
    expect(lawYearFor(2025)).toBe(2025);
    expect(lawYearFor(2026)).toBe(2026);
    expect(lawYearFor(2027)).toBe(2027);
    expect(lawYearFor(2028)).toBe(2027);
    expect(lawYearFor(2031)).toBe(2027);
    expect(() => lawYearFor(2024)).toThrow(NoTaxParamsError);
  });
});

describe("the student-tax helpers take the year too", () => {
  it("the 2025 and 2026 standard deduction and tax on $50,000 of wages", () => {
    expect(standardDeductionOf("single", false, $(50_000), 2025)).toBe($(15_750));
    expect(standardDeductionOf("single", false, $(50_000), 2026)).toBe($(16_100));
    // HE-2 again, through the helper the student cards use: $3,871.50 in 2025, $3,820.00 in 2026.
    expect(federalTaxOf($(50_000), "single", false, $(50_000), 2025)).toBe(387_150);
    expect(federalTaxOf($(50_000), "single", false, $(50_000), 2026)).toBe(382_000);
  });

  it("the note and the rough-state line name the estimate's own year", () => {
    expect(estimateNote(2025)).toContain("Tax figures for 2025 are from the IRS");
    expect(lawYearOf("2027-05-02")).toBe(2027);
    expect(() => lawYearOf("2028-05-02")).toThrow(NoTaxParamsError);
    expect(lawYearOf("2025-03-01")).toBe(2025);
  });
});
