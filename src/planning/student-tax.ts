import { DAY_MS } from "@/lib/dates";
import { DEPENDENT_STANDARD_DEDUCTION, ESTIMATED_TAX } from "@/config/student-taxes";
import { isFilingStatus, type FilingStatus } from "@/config/tax";
import { FEDERAL_BRACKETS, STANDARD_DEDUCTION } from "@/config/tax-rates";
import { DETECTOR_RATES } from "@/config/detectors";
import type { ProfileInput, ProfileTx } from "@/profile/build";
import { payForYear, payInYearData } from "@/profile/pay-on-schedule";
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
  // Of the wages, extra pay from an employer on a schedule (a bonus), grossed up and counted once.
  extraPayCents: number;
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
  // Pay on a schedule, in data that starts this year, is a month by its schedule, as the profile
  // has it (src/profile/pay-on-schedule.ts): one month's file with three paychecks every two weeks
  // read "Income near $28,489.50" on the Saver's Credit, where the schedule says about $20,956
  // (debug 3, upload S5, 11-19). This year's months from January already hold every payday but one.
  // A bonus from that employer isn't in its month: it's paid once, so the year adds it once. A job
  // whose first paycheck comes well after the data starts began then: its paid and paydays left.
  // In data from before January, the year so far is what was paid, each paycheck once, and the
  // rest of it the paydays each employer still paying has left by Dec 31 (payForYear): paced over
  // the months the data covers, 20 paychecks twice a month by Oct 23 read as 24.68 a year (gate C,
  // 11-20). Pay with no schedule is still paced. A year with no pay yet is left to the month.
  const grossPay = (rows: readonly ProfileTx[]) => {
    if (first < `${year}-01-01`) {
      const history = data.transactions.filter((t) => t.amountCents < 0 && t.date <= last);
      const pay = payForYear(history, rows, last, `${year}-12-31`);
      const rest = sumCents(rows.filter((t) => !pay.covered.has(t)));
      const scheduled = Math.round((pay.paidCents + pay.leftCents) * DETECTOR_RATES.tax.netToGross);
      return { cents: (pay.covered.size > 0 ? scheduled : 0) + grossYear(rest), extra: 0 };
    }
    // A job that began after the data starts is what it paid and its paydays left (payInYearData).
    const on = payInYearData(rows, last, `${year}-12-31`, first);
    const rest = sumCents(rows.filter((t) => !on.covered.has(t)));
    const extra = Math.round(on.extraCents * DETECTOR_RATES.tax.netToGross);
    const started = Math.round(on.startedCents * DETECTOR_RATES.tax.netToGross);
    const month = on.monthCents + Math.round(rest / Math.max(1, span));
    return {
      cents: Math.round(month * 12 * DETECTOR_RATES.tax.netToGross) + started + extra,
      extra,
    };
  };
  const gig = data.transactions.filter(
    (t) =>
      t.amountCents < 0 &&
      t.date.startsWith(`${year}-`) &&
      t.date <= data.today &&
      (t.pfc === "INCOME_GIG_ECONOMY" || t.pfc === "INCOME_CONTRACTOR"),
  );
  const said = facts.school_deposit?.value;
  const wages = grossPay(money.wages);
  const stipend =
    said === "wage" || said === "aid_refund" ? 0 : pace(sumCents(money.schoolDeposits));
  const schoolPayAsWage = said === "wage" ? grossYear(sumCents(money.schoolDeposits)) : 0;
  const gigCents = pace(sumCents(gig));
  const wagesCents = wages.cents + schoolPayAsWage;
  return {
    wagesCents,
    gigCents,
    stipendCents: stipend,
    earnedCents: wagesCents + gigCents,
    agiCents: wagesCents + gigCents + stipend,
    extraPayCents: wages.extra,
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
