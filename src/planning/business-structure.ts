import { S_CORP, S_CORP_COSTS_CENTS } from "@/config/business-structure";
import { PAYROLL_TAX, QBI, SELF_EMPLOYMENT_TAX } from "@/config/tax-rates";
import { estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";

// Business owners' tax structure (spec step 267). Pure: the qualified business income
// deduction a sole proprietor gets, and whether an S corporation would save more than its
// costs at this profit, using the same estimate engine as step 120 so the numbers agree.

const round = Math.round;
const clamp0 = (n: number) => Math.max(0, n);

export type Structure = {
  profitCents: number;
  // Schedule C (the default): the federal tax, and the deduction inside it.
  sole: { taxCents: number; qbiCents: number; qbiSavesCents: number; qbiLimited: boolean };
  sCorp: {
    // A salary range and the mid-point the numbers use.
    salaryLowCents: number;
    salaryHighCents: number;
    salaryCents: number;
    // Federal income tax on salary plus what's left, with its QBI deduction.
    incomeTaxCents: number;
    // Payroll tax on the salary, both halves.
    payrollTaxCents: number;
    costsCents: number;
    totalCents: number;
    // What it saves over staying as a sole proprietor; negative when it would cost.
    savesCents: number;
    worthIt: boolean;
  };
};

const ficaOn = (salary: number) =>
  round(
    Math.min(salary, SELF_EMPLOYMENT_TAX.wageBase) * PAYROLL_TAX.socialSecurityRate +
      salary * PAYROLL_TAX.medicareRate,
  );

export function structureFor(input: EstimateInput): Structure {
  const profit = clamp0(input.income.selfEmploymentCents);
  const base = estimateTaxes(input);
  const status = input.filingStatus;
  const limited = base.taxableCents + base.qbiCents > QBI.threshold[status];

  const low = Math.min(
    profit,
    Math.max(S_CORP.salaryFloorCents, round(profit * S_CORP.salaryShareLow)),
  );
  const high = Math.min(
    profit,
    Math.max(S_CORP.salaryFloorCents, round(profit * S_CORP.salaryShareHigh)),
  );
  const salary = round((low + high) / 2);
  // The employer half of the payroll tax is a business expense: it comes out of the profit.
  const employer = ficaOn(salary);
  const k1 = clamp0(profit - salary - employer);
  const s = estimateTaxes({
    ...input,
    income: {
      ...input.income,
      selfEmploymentCents: 0,
      wagesCents: input.income.wagesCents + salary,
      socialSecurityWagesCents: input.income.socialSecurityWagesCents + salary,
      otherCents: (input.income.otherCents ?? 0) + k1,
    },
  });
  // The pass-through income earns the same 20% deduction (below the limits), which the
  // engine only gives to self-employment income.
  const qbiS = limited ? 0 : round(Math.min(k1 * QBI.rate, clamp0(s.taxableCents) * QBI.rate));
  const incomeTax = clamp0(s.totalTaxCents - round(qbiS * s.marginalRate));
  const payroll = employer + ficaOn(salary);
  const total = incomeTax + payroll + S_CORP_COSTS_CENTS;
  const saves = base.totalTaxCents - total;
  return {
    profitCents: profit,
    sole: {
      taxCents: base.totalTaxCents,
      qbiCents: base.qbiCents,
      qbiSavesCents: round(base.qbiCents * base.marginalRate),
      qbiLimited: limited,
    },
    sCorp: {
      salaryLowCents: low,
      salaryHighCents: high,
      salaryCents: salary,
      incomeTaxCents: incomeTax,
      payrollTaxCents: payroll,
      costsCents: S_CORP_COSTS_CENTS,
      totalCents: total,
      savesCents: saves,
      worthIt: saves >= S_CORP.minSavingCents,
    },
  };
}
