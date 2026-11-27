import { describe, expect, it } from "vitest";
import { estimateTaxes, NO_INCOME, type EstimateInput } from "@/planning/tax-estimate";

// Tax T4 (5): the earned income credit is resident-only (IRS Pub. 519). The estimator leaves it out
// itself when EstimateInput.residentCreditsAllowed is false, so every re-run on a view's input (a
// what-if, a family or giving or business-structure or multi-year projection) leaves it out too.
const $ = (dollars: number) => Math.round(dollars * 100);

const family = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "head_of_household",
  childrenUnder17: 2,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, wagesCents: $(24_000), socialSecurityWagesCents: $(24_000) },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: $(1_000),
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
  ...over,
});

describe("residentCreditsAllowed", () => {
  it("defaults to counting the credit, so the figures every caller had do not move", () => {
    const e = estimateTaxes(family());
    expect(e.credits.earnedIncomeCreditCents).toBeGreaterThan(0);
    expect(estimateTaxes(family({ residentCreditsAllowed: true }))).toEqual(e);
  });

  it("leaves the credit out inside the estimator: the tax rises and the refund falls by exactly it", () => {
    const withCredit = estimateTaxes(family());
    const held = estimateTaxes(family({ residentCreditsAllowed: false }));
    const credit = withCredit.credits.earnedIncomeCreditCents;
    expect(held.credits.earnedIncomeCreditCents).toBe(0);
    expect(held.totalTaxCents).toBe(withCredit.totalTaxCents + credit);
    expect(held.refundCents).toBe(withCredit.refundCents - credit);
  });

  it("holds for every what-if re-run on the same input (more wages, a gift, a business, a child)", () => {
    const base = family({ residentCreditsAllowed: false });
    const reruns: EstimateInput[] = [
      { ...base, charityCents: $(2_000) },
      {
        ...base,
        income: { ...base.income, wagesCents: $(18_000), socialSecurityWagesCents: $(18_000) },
      },
      { ...base, income: { ...base.income, selfEmploymentCents: $(6_000) } },
      { ...base, childrenUnder17: 3 },
      { ...base, year: 2025 },
      { ...base, filingStatus: "married_joint" },
    ];
    for (const input of reruns) {
      expect(estimateTaxes(input).credits.earnedIncomeCreditCents).toBe(0);
    }
  });
});
