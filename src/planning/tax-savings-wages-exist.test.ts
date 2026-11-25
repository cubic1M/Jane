import { describe, expect, it } from "vitest";
import { CONTRIBUTION_LIMITS } from "@/config/tax-rates";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { findTaxSavings, type SavingsInput } from "./tax-savings";

// CodeRabbit sweep 1c, pl-09 #1 and #3: a saving is never worked out on wages that don't
// exist, and a traditional IRA is only suggested to someone with earned income.

const $ = (d: number) => Math.round(d * 100);
const input = (o: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "IL",
  income: { ...NO_INCOME, wagesCents: $(85_000), socialSecurityWagesCents: $(85_000) },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: $(12_000),
  federalEstimatedPaidCents: 0,
  stateWithheldCents: $(4_000),
  stateEstimatedPaidCents: 0,
  ...o,
});
const savings = (i: EstimateInput, o: Partial<SavingsInput> = {}) =>
  findTaxSavings({
    year: 2026,
    today: "2026-10-18",
    input: i,
    estimate: estimateTaxes(i),
    pay: {
      hasPlan: false,
      projectedRetirementCents: 0,
      paychecksLeft: 4,
      grossPerPaycheckCents: 0,
    },
    hasHsa: false,
    medicalCents: 0,
    childcareCents: 0,
    tuition: [],
    energyLastYear: [],
    ...o,
  });

describe("savings never use wages that aren't there", () => {
  it("an HSA with no wages doesn't invent a payroll saving or negative wages", () => {
    const retired = input({ income: { ...NO_INCOME, socialSecurityWagesCents: 0 } });
    const hsa = savings(retired, { hasHsa: true }).find((s) => s.key === "hsa");
    expect(hsa?.estimateCents ?? 0).toBe(0);
  });

  it("an HSA over the wages only counts the wages that exist", () => {
    const small = input({
      income: { ...NO_INCOME, wagesCents: $(2_000), socialSecurityWagesCents: $(2_000) },
    });
    const hsa = savings(small, { hasHsa: true }).find((s) => s.key === "hsa");
    // 7.65% payroll tax on $2,000 at most, plus the income tax on it: under $2,000 * 0.45.
    expect(hsa?.estimateCents ?? 0).toBeLessThan($(2_000) * 0.45);
  });
});

describe("traditional IRA needs earned income", () => {
  it("is not suggested to a retired person with no wages or self-employment", () => {
    const retired = input({
      income: { ...NO_INCOME, wagesCents: 0, retirementCents: $(40_000), interestCents: $(5_000) },
    });
    expect(savings(retired).some((s) => s.key === "ira")).toBe(false);
  });

  it("is capped at what the person earned", () => {
    const low = input({
      income: { ...NO_INCOME, wagesCents: $(3_000), socialSecurityWagesCents: $(3_000) },
    });
    const ira = savings(low).find((s) => s.key === "ira");
    expect(ira?.action.kind === "goal" && ira.action.targetCents).toBe($(3_000));
  });

  it("self-employment counts, and a normal earner keeps the full limit", () => {
    const se = input({ income: { ...NO_INCOME, wagesCents: 0, selfEmploymentCents: $(40_000) } });
    expect(savings(se).some((s) => s.key === "ira")).toBe(true);
    const ira = savings(input()).find((s) => s.key === "ira");
    expect(ira?.action.kind === "goal" && ira.action.targetCents).toBe(CONTRIBUTION_LIMITS.ira);
  });
});
