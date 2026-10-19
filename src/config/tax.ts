import type { PfcDetailed } from "@/categorize/taxonomy";
import type { AutopilotChoice } from "@/config/autopilot";
import { CHARITY_CATEGORIES, PREPARER_GROUPS } from "@/config/tax-pack";

// Taxes (spec steps 118–127): what Jane needs to know, how she works it out from the
// person's accounts and what she does by herself at each autopilot level. Tax rates,
// brackets and limits are in src/config/tax-rates.ts.

// The tax year Jane works on during the year. Until the filing deadline the pack still
// opens on last year (src/config/tax-pack.ts TAX_PACK_LAST_YEAR_UNTIL).
export const TAX_YEAR = 2026;

// Spec step 118: the federal filing statuses Jane asks about. A qualifying surviving spouse
// uses the married-filing-jointly figures and is picked as that on the profile page.
export const FILING_STATUSES = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
} as const;
export type FilingStatus = keyof typeof FILING_STATUSES;
export const isFilingStatus = (value: unknown): value is FilingStatus =>
  typeof value === "string" && Object.hasOwn(FILING_STATUSES, value);

// Kinds of income, how Jane says it when she's seen it, the form each usually comes on, and how Jane spots each in the
// person's transactions (Plaid personal finance categories) and accounts (Plaid
// investment subtypes for taxable accounts, from Plaid's account type docs). Pensions and
// unemployment are taxable too, so they're asked about as well.
export const INCOME_KINDS = {
  w2: {
    label: "Wages from a job",
    seen: "wages",
    form: "W-2",
    categories: ["INCOME_SALARY", "INCOME_MILITARY"],
  },
  self_employed: {
    label: "Freelance, contract or gig work",
    seen: "freelance or gig pay",
    form: "1099-NEC or 1099-K",
    categories: ["INCOME_CONTRACTOR", "INCOME_GIG_ECONOMY"],
  },
  rental: {
    label: "Rent from a property",
    seen: "rent",
    form: "Schedule E",
    categories: ["INCOME_RENTAL"],
  },
  investment: {
    label: "Interest, dividends or sales of investments",
    seen: "investment income",
    form: "1099-INT, 1099-DIV or 1099-B",
    categories: ["INCOME_DIVIDENDS", "INCOME_INTEREST_EARNED"],
  },
  retirement: {
    label: "A pension or retirement payouts",
    seen: "pension or retirement payouts",
    form: "1099-R",
    categories: ["INCOME_RETIREMENT_PENSION"],
  },
  unemployment: {
    label: "Unemployment benefits",
    seen: "unemployment benefits",
    form: "1099-G",
    categories: ["INCOME_UNEMPLOYMENT"],
  },
} as const satisfies Record<
  string,
  { label: string; seen: string; form: string; categories: readonly PfcDetailed[] }
>;
export type IncomeKind = keyof typeof INCOME_KINDS;
export const INCOME_KIND_ORDER = Object.keys(INCOME_KINDS) as IncomeKind[];
export const isIncomeKind = (value: unknown): value is IncomeKind =>
  typeof value === "string" && Object.hasOwn(INCOME_KINDS, value);

// Investment accounts whose gains and dividends are taxed each year (Plaid investment
// subtypes). Retirement and health accounts (401k, IRA, HSA, 529) aren't in it.
export const TAXABLE_INVESTMENT_SUBTYPES: readonly string[] = [
  "brokerage",
  "mutual fund",
  "stock plan",
  "trust",
  "ugma",
  "utma",
  "crypto exchange",
];

// How far back Jane looks for income, in days: a full year, so a yearly payment counts.
export const TAX_PROFILE_LOOKBACK_DAYS = 365;
// Wages count once there are this many paychecks; one-off payments count from the first.
export const TAX_PROFILE_MIN_PAYCHECKS = 2;
// Payers named in Jane's message, most paid first.
export const TAX_PROFILE_PAYERS_SHOWN = 2;

// Spending that hints at children, so Jane mentions it when she asks (never assumes).
export const CHILDCARE_HINT_CATEGORIES: readonly PfcDetailed[] = ["GENERAL_SERVICES_CHILDCARE"];

// Payments to government agencies whose name starts with a state's code ("CA DMV …"), so
// Jane can suggest the state when it isn't in Settings.
export const STATE_AGENCY_CATEGORIES: readonly PfcDetailed[] = [
  "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
];

// The most dependants of each kind the profile takes.
export const MAX_DEPENDANTS = 15;

// Spec step 119: tax tags on transactions. Jane tags spending in these categories by
// herself; "check" tags are ones she asks about (an online course may not be education
// for taxes). Work expenses are only ever tagged by the person. Tags sit beside the
// spending categories and never change them, so spending totals stay the same.
export const TAX_TAGS = {
  donation: {
    label: "Donation",
    plural: "donations",
    categories: CHARITY_CATEGORIES,
    check: false,
  },
  medical: {
    label: "Medical",
    plural: "medical",
    categories: PREPARER_GROUPS.medical,
    check: false,
  },
  childcare: {
    label: "Childcare",
    plural: "childcare",
    categories: PREPARER_GROUPS.childcare,
    check: false,
  },
  education: {
    label: "Education",
    plural: "education",
    categories: PREPARER_GROUPS.education,
    check: true,
  },
  work: { label: "Work expense", plural: "work expenses", categories: [], check: false },
} as const satisfies Record<
  string,
  { label: string; plural: string; categories: readonly PfcDetailed[]; check: boolean }
>;
export type TaxTagKind = keyof typeof TAX_TAGS;
export const TAX_TAG_ORDER = Object.keys(TAX_TAGS) as TaxTagKind[];
export const isTaxTagKind = (value: unknown): value is TaxTagKind =>
  typeof value === "string" && Object.hasOwn(TAX_TAGS, value);
// What a person's "not for taxes" is stored as.
export const UNTAGGED = "none";

// /taxes/tags shows at most this many transactions when searching for one to tag.
export const TAX_TAG_SEARCH_LIMIT = 50;

// Spec step 119: the tax forms to expect, from the income and loans Jane sees. Usual dates
// (MM-DD, the year after the tax year) the payer must send each by; a weekend or holiday
// moves it to the next business day, so Jane says "by about". Thresholds in cents: below
// them a payer needn't send a form (the income still counts). For review: from the IRS
// "General Instructions for Certain Information Returns" (2026) and the One Big Beautiful
// Bill Act, which raised the 1099-NEC/MISC threshold from $600 to $2,000 for payments made
// in 2026 and put the 1099-K threshold back to $20,000 and 200 payments.
export const TAX_FORMS = {
  w2: { form: "W-2", what: "wages", by: "01-31" },
  nec: { form: "1099-NEC or 1099-K", what: "freelance or gig pay", by: "01-31" },
  int: { form: "1099-INT", what: "interest", by: "01-31" },
  brokerage: { form: "consolidated 1099 (DIV and B)", what: "dividends and sales", by: "02-15" },
  r: { form: "1099-R", what: "pension or retirement payouts", by: "01-31" },
  g: { form: "1099-G", what: "unemployment benefits", by: "01-31" },
  mortgage: { form: "1098", what: "mortgage interest", by: "01-31" },
  student: { form: "1098-E", what: "student loan interest", by: "01-31" },
} as const;
export type TaxFormKey = keyof typeof TAX_FORMS;
// For review: 1099-NEC/MISC, by the year the money was paid.
export const NEC_THRESHOLD_CENTS: Readonly<Record<number, number>> = {
  2025: 60_000,
  2026: 200_000,
};
export const necThreshold = (year: number) =>
  NEC_THRESHOLD_CENTS[year] ??
  NEC_THRESHOLD_CENTS[Math.max(...Object.keys(NEC_THRESHOLD_CENTS).map(Number))];
// For review: 1099-INT at $10 of interest; 1098-E at $600 of student loan interest; 1098 at
// $600 of mortgage interest.
export const INT_THRESHOLD_CENTS = 1_000;
export const STUDENT_INTEREST_THRESHOLD_CENTS = 60_000;
export const MORTGAGE_INTEREST_THRESHOLD_CENTS = 60_000;
// Jane starts asking whether forms have arrived from this day (MM-DD) of the year after.
export const TAX_FORMS_ASK_FROM = "01-20";
// ...until this day (MM-DD), the usual filing deadline.
export const TAX_FORMS_ASK_UNTIL = "04-15";

// Spec step 120: the demo bank's stand-in pay stub, per paycheck, for its ACME CORP
// PAYROLL deposits (src/lib/payroll/demo.ts). A real payroll connection (Plaid Income's
// payroll data, or a payroll provider) replaces it. Net pay is the deposit: $2,450.00.
export const DEMO_PAY_STUB = {
  grossCents: 395_000,
  retirementCents: 23_700,
  // Health premiums, pre-tax (not subject to Social Security or Medicare).
  otherPretaxCents: 14_500,
  federalWithheldCents: 56_557,
  stateWithheldCents: 21_000,
  socialSecurityCents: 23_591,
  medicareCents: 5_517,
  // State disability insurance (California SDI).
  stateDisabilityCents: 5_135,
  netCents: 245_000,
} as const;

// Paychecks a year by the usual gap between them, in days.
export const PAY_FREQUENCIES: readonly { maxGap: number; perYear: number; label: string }[] = [
  { maxGap: 9, perYear: 52, label: "weekly" },
  { maxGap: 14, perYear: 26, label: "every two weeks" },
  { maxGap: 17, perYear: 24, label: "twice a month" },
  { maxGap: 35, perYear: 12, label: "monthly" },
];

// Spec step 121: the withholding checkup. A refund over bigRefund, or a bill over bill, is
// worth a W-4 change; the change aims for a small refund of target. Amounts are rounded:
// extra withholding per paycheck up to a whole dollar, Step 4(b) deductions down to $100.
export const WITHHOLDING = {
  targetRefundCents: 30_000,
  bigRefundCents: 100_000,
  billCents: 10_000,
  roundExtraCents: 100,
  roundDeductionCents: 10_000,
} as const;
export const IRS_WITHHOLDING_ESTIMATOR_URL =
  "https://www.irs.gov/individuals/tax-withholding-estimator";
export const IRS_W4_URL = "https://www.irs.gov/forms-pubs/about-form-w-4";

// Spec step 122: the tax savings finder (demo advice). Savings under this many cents a year
// aren't shown. Purchases that look like tuition or home energy work are spotted by these
// words in the payee.
export const TAX_SAVINGS_MIN_CENTS = 2_500;
export const TUITION_PAYEE = /\b(?:UNIV(?:ERSITY)?|COLLEGE|TUITION|BURSAR|COMMUNITY COLL|SCHOOL OF)\b/i;
export const ENERGY_PAYEE =
  /\b(?:SOLAR|SUNRUN|SUNPOWER|SUNNOVA|TESLA ENERGY|HEAT PUMP|MITSUBISHI ELECTRIC|INSULATION|ENERGY STAR|GEOTHERMAL|POWERWALL)\b/i;
// Health FSA: suggested when out-of-pocket medical spending this year is over this.
export const FSA_SUGGEST_FROM_CENTS = 50_000;
// When open enrollment usually ends (MM-DD): the reminder Jane sets for it.
export const OPEN_ENROLLMENT_BY = "11-30";
// Bunching gifts: suggested when doubling a year's gifts would take itemized deductions
// past the standard deduction.

// The estimate tells the person when it has moved by at least this much (in cents) since
// Jane last said it.
export const TAX_ESTIMATE_STEP_CENTS = 50_000;

// The chat (src/lib/jane-agent/sources/taxes.ts): how important tax messages are, among
// the others in src/config/agent-chat.ts MESSAGE_PRIORITY.
export const TAX_MESSAGE_PRIORITY = {
  profile: 35,
  new_income: 36,
  // Spec step 119.
  tag_check: 33,
  tag_month: 25,
  form_due: 38,
  // Spec step 120.
  estimate: 30,
  // Spec step 121.
  withholding: 37,
  // Spec step 122.
  saving: 34,
} as const;

// What Jane does about taxes by herself at each autopilot level (spec step 57), shown on
// /taxes and said in the chat, one entry per feature: what she does when the person asks
// her to check first ("Ask me first", or no level picked yet) and at the levels that let
// her act (safe, everything allowed, custom). Nothing is ever filed, signed or paid
// without a tap.
export type TaxAutopilotLevel = AutopilotChoice | "custom" | "none";
export const TAX_AUTOPILOT: readonly { feature: string; ask: string; auto: string }[] = [
  {
    feature: "profile",
    ask: "I work out your tax profile from your accounts and ask you to check it; I only use what you've told me or said yes to.",
    auto: "I keep your tax profile up to date from your accounts and use what I find straight away, marked as found by me, until you check it. I ask before adding a new kind of income.",
  },
  {
    feature: "estimate",
    ask: "I keep your tax estimate up to date after every sync, from your income so far.",
    auto: "I keep your tax estimate up to date after every sync, and tell you when it moves by $500 or more.",
  },
  {
    feature: "withholding",
    ask: "I check your withholding against your estimate and, with demo advice, show what to put on a new W-4. Only you can send it to your employer.",
    auto: "I check your withholding after every sync and bring up a W-4 change when you're heading for a big refund or a bill. Only you can send it to your employer.",
  },
  {
    feature: "savings",
    ask: "With demo advice, I look for ways to pay less (retirement and health accounts, deductions, credits) and show each with an estimate; you pick which to act on.",
    auto: "With demo advice, I look for ways to pay less after every sync and bring up each new one with the goal or reminder ready to set with one tap. I never change your contributions myself.",
  },
  {
    feature: "tags",
    ask: "I tag donations, medical, childcare and education spending as it comes in, and ask about anything I'm unsure of.",
    auto: "I tag donations, medical, childcare and education spending as it comes in, ask about anything I'm unsure of, and tell you each month what I tagged.",
  },
];

export function whatJaneDoes(level: string | null): string[] {
  const auto = level === "safe" || level === "all" || level === "custom";
  return TAX_AUTOPILOT.map((line) => (auto ? line.auto : line.ask));
}

// Whether Jane may use what she found before the person has said yes to it.
export const usesFoundAnswers = (level: string | null): boolean =>
  level === "safe" || level === "all" || level === "custom";
