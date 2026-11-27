import type { TaxEstimate } from "@/planning/tax-estimate";

// Every figure the estimate shows, by a stable id. A bench case says which of these it checks; the
// coverage test (Tax T2, "no figure ships without a case") fails when one has no case at all.
// Money in cents. Not here: the marginal rate (a rate, not a line) and the state lines (no state figure is verified
// at its source yet: T20 and T21 add California's; the other states have no owner).
export const FIGURES = {
  totalIncome: (e) => e.totalIncomeCents,
  socialSecurityTaxable: (e) => e.socialSecurityTaxableCents,
  halfSelfEmploymentTax: (e) => e.adjustments.halfSelfEmploymentTaxCents,
  studentLoanInterest: (e) => e.adjustments.studentLoanInterestCents,
  agi: (e) => e.agiCents,
  standardDeduction: (e) => e.deduction.standardCents,
  itemizedStateLocal: (e) => e.deduction.itemized.stateLocalTaxCents,
  itemizedMortgage: (e) => e.deduction.itemized.mortgageInterestCents,
  itemizedCharity: (e) => e.deduction.itemized.charityCents,
  itemizedMedical: (e) => e.deduction.itemized.medicalCents,
  nonItemizerCharity: (e) => e.deduction.nonItemizerCharityCents,
  qbi: (e) => e.qbiCents,
  taxable: (e) => e.taxableCents,
  incomeTax: (e) => e.incomeTaxCents,
  selfEmploymentTax: (e) => e.selfEmploymentTaxCents,
  additionalMedicare: (e) => e.additionalMedicareCents,
  netInvestmentIncomeTax: (e) => e.netInvestmentIncomeTaxCents,
  amt: (e) => e.amtCents,
  childTaxCredit: (e) => e.credits.childTaxCreditCents,
  otherDependantCredit: (e) => e.credits.otherDependantCreditCents,
  additionalChildTaxCredit: (e) => e.credits.additionalChildTaxCreditCents,
  earnedIncomeCredit: (e) => e.credits.earnedIncomeCreditCents,
  totalTax: (e) => e.totalTaxCents,
  paid: (e) => e.paidCents,
  refund: (e) => e.refundCents,
} as const satisfies Record<string, (e: TaxEstimate) => number>;

export type FigureId = keyof typeof FIGURES;
export const FIGURE_IDS = Object.keys(FIGURES) as FigureId[];
