import { describe, expect, it } from "vitest";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { findTaxSavings } from "./tax-savings";

// Debugger 11-13, the demo bank on Taxes and Insurance: Taxes said "Use a health FSA" and "Sign
// up for an FSA by Nov 30" while Insurance's health year said "$1,670.64 is left in your FSA".
// Someone who has a health FSA isn't told to get one.

const input: EstimateInput = {
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "IL",
  income: { ...NO_INCOME, wagesCents: 8_500_000, socialSecurityWagesCents: 9_000_000 },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: 1_200_000,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 400_000,
  stateEstimatedPaidCents: 0,
};
const keys = (hasFsa: boolean) =>
  findTaxSavings({
    year: 2026,
    today: "2026-11-13",
    input,
    estimate: estimateTaxes(input),
    pay: {
      hasPlan: false,
      projectedRetirementCents: 0,
      paychecksLeft: 3,
      grossPerPaycheckCents: 0,
    },
    hasHsa: false,
    hasFsa,
    medicalCents: 107_100,
    childcareCents: 0,
    tuition: [],
    energyLastYear: [],
  }).map((s) => s.key);

describe("a health FSA", () => {
  it("isn't suggested to someone who already has one", () => {
    expect(keys(true)).not.toContain("health_fsa");
  });

  it("is still suggested to someone with a job, medical costs and none", () => {
    expect(keys(false)).toContain("health_fsa");
  });
});
