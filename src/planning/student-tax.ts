import { DEPENDENT_STANDARD_DEDUCTION, ESTIMATED_TAX } from "@/config/student-taxes";
import { isFilingStatus, type FilingStatus } from "@/config/tax";
import { FEDERAL_BRACKETS, STANDARD_DEDUCTION } from "@/config/tax-rates";
import { bracketTax } from "./tax-brackets";

// The arithmetic the student tax cards share (suggest-taxes, 11-18), from the published rules in
// src/config/student-taxes.ts and ./tax-rates.ts. Pure.

type Facts = Record<string, { value: unknown }>;

// How they file: what they said, else a couple files jointly and anyone else alone. A student's
// household is nearly always just them.
export function filingStatusOf(facts: Facts): FilingStatus {
  const said = facts.filing_status?.value;
  if (isFilingStatus(said)) return said;
  const household = facts.household?.value;
  return household === "couple" || household === "family" ? "married_joint" : "single";
}

// What they said about being someone's dependent: "yes", "no", or null for not said or not sure.
export function dependentOf(facts: Facts): "yes" | "no" | null {
  const v = facts.claimed_as_dependent?.value;
  return v === "yes" || v === "no" ? v : null;
}

// On an F or J student visa, a student is usually a nonresident for tax in their first five
// calendar years: different forms, and none of the credits below.
export const onStudentVisa = (facts: Facts) => facts.tax_residency?.value === "student_visa";

// The 2026 standard deduction: the regular one, or a dependent's (the greater of $1,350 or earned
// income plus $450, never more than the regular one). A taxable fellowship counts as earned.
export function standardDeductionOf(
  status: FilingStatus,
  dependent: boolean,
  earnedCents: number,
): number {
  const regular = STANDARD_DEDUCTION[status];
  if (!dependent) return regular;
  const own = Math.max(
    DEPENDENT_STANDARD_DEDUCTION.floorCents,
    earnedCents + DEPENDENT_STANDARD_DEDUCTION.plusEarnedCents,
  );
  return Math.min(regular, own);
}

// Federal income tax on a year's income (ordinary rates, the standard deduction), before credits.
export function federalTaxOf(
  incomeCents: number,
  status: FilingStatus,
  dependent: boolean,
  earnedCents = incomeCents,
): number {
  const taxable = Math.max(0, incomeCents - standardDeductionOf(status, dependent, earnedCents));
  return bracketTax(taxable, FEDERAL_BRACKETS[status]);
}

// The next estimated payment for the tax year, or null once the last one has passed.
export function nextEstimatedDate(today: string): (typeof ESTIMATED_TAX.dates)[number] | null {
  return ESTIMATED_TAX.dates.find((d) => d.due >= today) ?? null;
}
