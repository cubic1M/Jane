import { DAY_MS } from "@/lib/dates";
import { DEPENDENT_STANDARD_DEDUCTION, ESTIMATED_TAX } from "@/config/student-taxes";
import { isFilingStatus, type FilingStatus } from "@/config/tax";
import { FEDERAL_BRACKETS, STANDARD_DEDUCTION } from "@/config/tax-rates";
import { DETECTOR_RATES } from "@/config/detectors";
import type { ProfileInput } from "@/profile/build";
import { studentMoney, sumCents } from "./student-money";
import { bracketTax } from "./tax-brackets";
import { marginalRateOf } from "./tax-estimate";

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

// A student's year at the pace their deposits show: pay (grossed up from take-home, as the other tax
// cards do), gig and contract pay, and school money that isn't pay (a fellowship), unless they said
// it's pay or aid. Earned income for the EITC is pay and gig (Pub. 596); AGI adds the fellowship.
export type StudentYear = {
  wagesCents: number;
  gigCents: number;
  stipendCents: number;
  earnedCents: number;
  agiCents: number;
};

export function studentYearOf(
  data: Pick<ProfileInput, "transactions" | "today">,
  facts: Facts,
  rateMonths: number,
): StudentYear {
  const money = studentMoney(data);
  const year = Number(data.today.slice(0, 4));
  // The rows are this year's (studentMoney), so with data from before January they're paced over
  // the months of this year the data covers, not the whole history's: 10.5 months of pay paced as
  // 12 read $18,744.80 a year beside the Saver's Credit's $27,444.46 (debug 2, upload S6, 11-19).
  const first = data.transactions.reduce((a, t) => (t.date < a ? t.date : a), data.today);
  const last = data.transactions
    .filter((t) => t.date <= data.today)
    .reduce((a, t) => (t.date > a ? t.date : a), `${year}-01-01`);
  const span =
    first < `${year}-01-01`
      ? Math.max(
          1,
          ((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / DAY_MS + 1) /
            (365.25 / 12),
        )
      : rateMonths;
  const pace = (cents: number) => Math.round((cents * 12) / Math.max(1, span));
  // Pay as a month first, then a year grossed up: the order the profile's monthly income and the
  // other tax cards use, so the same pay is one figure on every card (debug 2, upload S5, 11-18).
  const grossYear = (cents: number) =>
    Math.round(Math.round(cents / Math.max(1, span)) * 12 * DETECTOR_RATES.tax.netToGross);
  const gig = data.transactions.filter(
    (t) =>
      t.amountCents < 0 &&
      t.date.startsWith(`${year}-`) &&
      t.date <= data.today &&
      (t.pfc === "INCOME_GIG_ECONOMY" || t.pfc === "INCOME_CONTRACTOR"),
  );
  const said = facts.school_deposit?.value;
  const wages = grossYear(sumCents(money.wages));
  const stipend =
    said === "wage" || said === "aid_refund" ? 0 : pace(sumCents(money.schoolDeposits));
  const schoolPayAsWage = said === "wage" ? grossYear(sumCents(money.schoolDeposits)) : 0;
  const gigCents = pace(sumCents(gig));
  const wagesCents = wages + schoolPayAsWage;
  return {
    wagesCents,
    gigCents,
    stipendCents: stipend,
    earnedCents: wagesCents + gigCents,
    agiCents: wagesCents + gigCents + stipend,
  };
}

// The top federal rate their next dollar of income is taxed at: 0 under the standard deduction.
export function marginalRateFor(
  agiCents: number,
  status: FilingStatus,
  dependent: boolean,
  earnedCents: number,
) {
  const taxable = agiCents - standardDeductionOf(status, dependent, earnedCents);
  return taxable <= 0 ? 0 : marginalRateOf(taxable, FEDERAL_BRACKETS[status]);
}

// What the age facts say about being from 25 to 64 at the year's end: true, false, or null unknown.
export function age25to64(facts: Facts): boolean | null {
  const age = facts.age?.value;
  if (typeof age === "number") return age >= 25 && age < 65;
  const band = facts.age_band?.value;
  if (band === "30_to_49" || band === "50_to_57") return true;
  if (band === "66_to_72" || band === "73_plus") return false;
  const said = facts.age_25_plus?.value;
  // "25 or older" with no band past 57: 65 and over is the band's to say.
  if (said === "no") return false;
  return said === "yes" && band !== "58_to_65" ? true : null;
}
