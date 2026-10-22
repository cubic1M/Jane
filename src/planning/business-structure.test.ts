import { describe, expect, it } from "vitest";
import { S_CORP, S_CORP_COSTS_CENTS } from "@/config/business-structure";
import { NO_INCOME, type EstimateInput } from "./tax-estimate";
import { structureFor } from "./business-structure";

// Spec step 267: the qualified business income deduction a sole proprietor gets, and whether an
// S corporation would save more than its costs at this profit, from the same engine as step 120.

const $ = (d: number) => Math.round(d * 100);
const owner = (profit: number, extra: Partial<EstimateInput["income"]> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: null,
  income: { ...NO_INCOME, selfEmploymentCents: $(profit), ...extra },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
});

describe("the S corporation question", () => {
  it("says no at a small profit, where the costs eat the saving", () => {
    const s = structureFor(owner(45_000));
    expect(s.sCorp.worthIt).toBe(false);
    expect(s.sCorp.savesCents).toBeLessThan(S_CORP.minSavingCents);
  });

  it("says yes at a profit where the payroll tax saved is bigger than the costs", () => {
    const s = structureFor(owner(150_000));
    expect(s.sCorp.worthIt).toBe(true);
    expect(s.sCorp.savesCents).toBeGreaterThan(S_CORP.minSavingCents);
    // The saving is the payroll tax on what isn't paid as salary, less the 20% deduction lost
    // on the salary and the costs: bigger profit, bigger saving.
    expect(structureFor(owner(250_000)).sCorp.savesCents).toBeGreaterThan(s.sCorp.savesCents);
  });

  it("adds up: total is income tax, both halves of payroll tax and the costs", () => {
    const s = structureFor(owner(120_000)).sCorp;
    expect(s.totalCents).toBe(s.incomeTaxCents + s.payrollTaxCents + S_CORP_COSTS_CENTS);
    expect(s.costsCents).toBe(S_CORP_COSTS_CENTS);
  });

  it("gives a salary range inside the profit, never below the floor, and the numbers use its middle", () => {
    const s = structureFor(owner(100_000)).sCorp;
    expect(s.salaryLowCents).toBe(Math.max(S_CORP.salaryFloorCents, $(40_000)));
    expect(s.salaryHighCents).toBe($(60_000));
    expect(s.salaryCents).toBe(Math.round((s.salaryLowCents + s.salaryHighCents) / 2));
    // Profit under the floor can't pay a salary bigger than itself.
    expect(structureFor(owner(20_000)).sCorp.salaryHighCents).toBe($(20_000));
  });

  it("agrees with the estimate for the sole proprietor", () => {
    const s = structureFor(owner(100_000));
    expect(s.profitCents).toBe($(100_000));
    expect(s.sole.taxCents).toBeGreaterThan(0);
  });
});

describe("the qualified business income deduction", () => {
  it("is 20% of profit less half the self-employment tax, worth its share of the bracket", () => {
    const s = structureFor(owner(100_000)).sole;
    expect(s.qbiCents).toBeGreaterThan($(10_000));
    expect(s.qbiCents).toBeLessThan($(20_000));
    expect(s.qbiSavesCents).toBeGreaterThan($(1_000));
    expect(s.qbiLimited).toBe(false);
  });

  it("is limited above the threshold, where Jane doesn't work out the rest", () => {
    const s = structureFor(owner(400_000)).sole;
    expect(s.qbiLimited).toBe(true);
    expect(s.qbiCents).toBe(0);
  });
});
