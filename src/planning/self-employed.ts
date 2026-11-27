import { MAX_HOME_OFFICE_SQFT, QUARTERLY } from "@/config/tax";
import { NoTaxParamsError } from "@/config/tax-params";
import {
  HOME_OFFICE_SIMPLIFIED,
  businessMileageCentsOn,
  undatedMileageCentsIn,
} from "@/config/tax-rates";
import { noParamsText } from "@/lib/tax-estimate-state";

// Freelancers' taxes (spec step 123). Pure. Estimated tax is paid in four parts during the
// year (src/config/tax-pack.ts ESTIMATED_TAX_DATES); what's still owed for the year, by the
// estimate, is split over the dates left, so the payments, the withholding and what's been
// paid add up to the estimate exactly.

type QuarterlyPayment = { date: string; cents: number };

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

// Business miles at the standard mileage rate of the tax year: the rate on the trip's own day
// (YYYY-MM-DD) when there is one, else the rate for miles with no date (mileageRateNote says
// which). The year's own rate, never another year's: for a year whose rate is not published yet
// this throws NoTaxParamsError with group "mileage" (use mileageFigure to keep the rest of a page).
export const mileageDeduction = (miles: number | null, year: number, tripDate?: string) =>
  miles
    ? Math.round(
        miles * (tripDate ? businessMileageCentsOn(tripDate) : undatedMileageCentsIn(year)),
      )
    : 0;

// The same for a page, a card or a chat answer: the deduction, or when the year's rate is awaited
// no figure and the W-N sentence for it (every other figure of the year is priced normally).
export type MileageFigure = { deductionCents: number; awaited: string | null };
export function mileageFigure(
  miles: number | null,
  year: number,
  tripDate?: string,
): MileageFigure {
  try {
    return { deductionCents: mileageDeduction(miles, year, tripDate), awaited: null };
  } catch (error) {
    if (error instanceof NoTaxParamsError && error.group === "mileage") {
      return { deductionCents: 0, awaited: noParamsText(error.year, error.group) };
    }
    throw error;
  }
}
