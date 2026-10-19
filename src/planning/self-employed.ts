import { MAX_HOME_OFFICE_SQFT, QUARTERLY } from "@/config/tax";
import { HOME_OFFICE_SIMPLIFIED, MILEAGE_RATE_CENTS } from "@/config/tax-rates";

// Freelancers' taxes (spec step 123). Pure. Estimated tax is paid in four parts during the
// year (src/config/tax-pack.ts ESTIMATED_TAX_DATES); what's still owed for the year, by the
// estimate, is split over the dates left, so the payments, the withholding and what's been
// paid add up to the estimate exactly.

export type QuarterlyPayment = { date: string; cents: number };

export type QuarterlyPlan = {
  // Still to pay for the year, by the estimate: tax less withholding and payments so far.
  owedCents: number;
  // False when it's under QUARTERLY.minOwedCents (no penalty under $1,000).
  needed: boolean;
  payments: QuarterlyPayment[];
};

export function quarterlyPlan(input: {
  dueDates: string[];
  today: string;
  totalTaxCents: number;
  withheldCents: number;
  paidCents: number;
  minOwedCents?: number;
}): QuarterlyPlan {
  const owed = input.totalTaxCents - input.withheldCents - input.paidCents;
  const needed = owed >= (input.minOwedCents ?? QUARTERLY.minOwedCents);
  const left = input.dueDates.filter((d) => d >= input.today).sort();
  if (!needed || left.length === 0) return { owedCents: Math.max(0, owed), needed, payments: [] };
  const each = Math.floor(owed / left.length);
  // The last payment takes the odd cents, so they add up exactly.
  const payments = left.map((date, i) => ({
    date,
    cents: i === left.length - 1 ? owed - each * (left.length - 1) : each,
  }));
  return { owedCents: owed, needed, payments };
}

// What share of each freelance payment to set aside: the tax the freelance income adds
// (income tax, state tax and self-employment tax) over the freelance money coming in.
export function setAsideRate(input: {
  taxWithCents: number;
  taxWithoutCents: number;
  freelanceInCents: number;
}): number {
  if (input.freelanceInCents <= 0) return 0;
  const rate = (input.taxWithCents - input.taxWithoutCents) / input.freelanceInCents;
  return Math.min(0.5, Math.max(0, Math.round(rate * 100) / 100));
}

// The simplified home office deduction: $5 a square foot, up to 300.
export const homeOfficeDeduction = (sqft: number | null) =>
  sqft
    ? Math.min(sqft, MAX_HOME_OFFICE_SQFT, HOME_OFFICE_SIMPLIFIED.maxSquareFeet) *
      HOME_OFFICE_SIMPLIFIED.perSquareFoot
    : 0;

// Business miles at the standard mileage rate.
export const mileageDeduction = (miles: number | null) =>
  miles ? Math.round(miles * MILEAGE_RATE_CENTS) : 0;
