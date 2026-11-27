import { DAY_MS } from "@/lib/dates";
import { ESTIMATED_TAX } from "@/config/student-taxes";
import type { FilingStatus } from "@/config/tax";
import { federalParams, ownLawYear } from "@/config/tax-params";
import { TAX_RATES_YEAR } from "@/config/tax-rates";
import { DETECTOR_RATES } from "@/config/detectors";
import type { ProfileInput, ProfileTx } from "@/profile/build";
import { payForYear, payInYearData } from "@/profile/pay-on-schedule";
import { monthsBetweenLines } from "@/detection/units";
import { studentMoney, sumCents } from "./student-money";
import { bracketTax } from "./tax-brackets";
import { marginalRateOf, standardDeductionFor } from "./tax-estimate";
import { filingStatusFor, type FilingRead } from "./tax-profile";

// The arithmetic the student tax cards share (suggest-taxes, 11-18), from the published rules in
// src/config/student-taxes.ts and ./tax-rates.ts. Pure.

type Facts = Record<string, { value: unknown; source?: string }>;

// How they file, as every reader reads it (filingStatusFor): what they said (the loader has
// already settled the question card against the tax profile); else the one guess (T8b): married
// filing jointly on a sign of a partner, otherwise single, never head of household. The profile's
// facts say the person's partner (has_partner: told, or seen from a joint account or two employers
// paying together; a told household of a couple or of one person says it too) and children.
export function filingReadOf(facts: Facts): FilingRead {
  const partner = facts.has_partner;
  const household = facts.household;
  const told = (f: { value: unknown; source?: string } | undefined) => f?.source === "told";
  const toldPartner =
    told(partner) && typeof partner?.value === "boolean"
      ? partner.value
      : told(household) && household?.value === "couple"
        ? true
        : told(household) && household?.value === "single"
          ? false
          : null;
  return filingStatusFor(facts, null, {
    partner: toldPartner,
    signs: partner?.value === true && !told(partner) ? ["signs of a partner in your accounts"] : [],
    children: facts.has_children?.value === true,
  });
}

export const filingStatusOf = (facts: Facts): FilingStatus => filingReadOf(facts).status;

// The sentence a card carries when it priced the person as single beside children: head of household
// may apply and would change the figure. Empty when there is nothing to assume.
export const filingNoteOf = (facts: Facts): string => {
  const note = filingReadOf(facts).assumption;
  return note ? ` ${note}` : "";
};

// What they said about being someone's dependent: "yes", "no", or null for not said or not sure.
export function dependentOf(facts: Facts): "yes" | "no" | null {
  const v = facts.claimed_as_dependent?.value;
  return v === "yes" || v === "no" ? v : null;
}

// On an F or J student visa, a student is usually a nonresident for tax in their first five
// calendar years: different forms, and none of the credits below.
export const onStudentVisa = (facts: Facts) => facts.tax_residency?.value === "student_visa";

// The person's told or read age, for the extra standard deduction at 65 (null when not known).
export const ageOf = (facts: Facts): number | null => {
  const age = facts.age?.value;
  return typeof age === "number" && Number.isFinite(age) ? age : null;
};

// The law year a student card prices with: the calendar year of its day. When Jane has no figures
// for it this throws NoTaxParamsError and the card is held back (runDetectors), never priced with
// another year's law.
export const lawYearOf = (today: string) => ownLawYear(Number(today.slice(0, 4)));

// The standard deduction for a student's year: the shared rule (standardDeductionFor in
// ./tax-estimate), so a card and the estimate cannot differ. `earnedCents` is earned income with any
// taxable fellowship added, as a dependent's limit counts it. `year` is the law year (lawYearOf); the
// default is only for callers not yet moved (tests).
export function standardDeductionOf(
  status: FilingStatus,
  dependent: boolean,
  earnedCents: number,
  year: number = TAX_RATES_YEAR,
  age: number | null = null,
): number {
  return standardDeductionFor(federalParams(year), {
    status,
    claimedAsDependent: dependent,
    earnedCents,
    age,
  });
}

// Federal income tax on a year's income (ordinary rates, the standard deduction), before credits.
export function federalTaxOf(
  incomeCents: number,
  status: FilingStatus,
  dependent: boolean,
  earnedCents = incomeCents,
  year: number = TAX_RATES_YEAR,
  age: number | null = null,
): number {
  const taxable = Math.max(
    0,
    incomeCents - standardDeductionOf(status, dependent, earnedCents, year, age),
  );
  return bracketTax(taxable, federalParams(year).brackets.value[status]);
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

// The months of this year the data covers: the whole history's rate months when it starts this year,
// else January 1 to the last line. What this year's rows are paced over (never the earlier months).
export function yearCoverageMonths(
  data: Pick<ProfileInput, "transactions" | "today">,
  rateMonths: number,
): number {
  const year = Number(data.today.slice(0, 4));
  const first = data.transactions.reduce((a, t) => (t.date < a ? t.date : a), data.today);
  const last = data.transactions
    .filter((t) => t.date <= data.today)
    .reduce((a, t) => (t.date > a ? t.date : a), `${year}-01-01`);
  return first < `${year}-01-01`
    ? Math.max(
        1,
        ((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / DAY_MS + 1) /
          (365.25 / 12),
      )
    : rateMonths;
}

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
  const span = yearCoverageMonths(data, rateMonths);
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
    // Pay off any schedule is spread over the lines' span, as the profile's month (payMonths).
    const month = on.monthCents + Math.round(rest / monthsBetweenLines(first, last));
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
      (t.pfc === "INCOME_GIG_ECONOMY" || t.pfc === "INCOME_CONTRACTOR") &&
      // Pay from a school's payroll is already in `wages` (studentMoney): a bank that files it as
      // gig or contractor income must not count it a second time.
      !money.schoolPay.includes(t),
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
  year: number = TAX_RATES_YEAR,
  age: number | null = null,
) {
  const taxable = agiCents - standardDeductionOf(status, dependent, earnedCents, year, age);
  return taxable <= 0 ? 0 : marginalRateOf(taxable, federalParams(year).brackets.value[status]);
}

// Whether the American opportunity credit's refundable part can reach them by age: it is not paid to
// a student under 24 at the year's end with a living parent (Form 8863 line 7), and has no upper
// age, unlike the EITC's 25 to 64. True from 24 up (or the bands above it), false under; null when
// the age isn't known.
export function aotcRefundableAge(facts: Facts): boolean | null {
  const age = facts.age?.value;
  if (typeof age === "number") return age >= 24;
  const band = facts.age_band?.value;
  if (
    band === "30_to_49" ||
    band === "50_to_57" ||
    band === "58_to_65" ||
    band === "66_to_72" ||
    band === "73_plus"
  )
    return true;
  return facts.age_25_plus?.value === "yes" ? true : null;
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
