import type { PfcDetailed } from "@/categorize/taxonomy";
import type { AutopilotChoice } from "@/config/autopilot";

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

// The chat (src/lib/jane-agent/sources/taxes.ts): how important tax messages are, among
// the others in src/config/agent-chat.ts MESSAGE_PRIORITY.
export const TAX_MESSAGE_PRIORITY = {
  profile: 35,
  new_income: 36,
} as const;

// What Jane does about taxes by herself at each autopilot level (spec step 57), shown on
// /taxes and said in the chat. Nothing is ever filed, signed or paid without a tap.
export type TaxAutopilotLevel = AutopilotChoice | "custom" | "none";
export const TAX_AUTOPILOT: Readonly<Record<TaxAutopilotLevel, readonly string[]>> = {
  none: [
    "I work out what I can from your accounts and ask you to check it.",
    "I only use what you've told me or said yes to.",
  ],
  ask: [
    "I work out what I can from your accounts and ask you to check it.",
    "I only use what you've told me or said yes to.",
  ],
  safe: [
    "I keep your tax profile up to date from your accounts and use what I find straight away, marked as found by me, until you check it.",
    "When I see a new kind of income, I tell you and ask before adding it.",
  ],
  all: [
    "I keep your tax profile up to date from your accounts and use what I find straight away, marked as found by me, until you check it.",
    "When I see a new kind of income, I tell you and ask before adding it.",
  ],
  custom: [
    "I keep your tax profile up to date from your accounts and use what I find straight away, marked as found by me, until you check it.",
    "When I see a new kind of income, I tell you and ask before adding it.",
  ],
};

// Whether Jane may use what she found before the person has said yes to it.
export const usesFoundAnswers = (level: string | null): boolean =>
  level === "safe" || level === "all" || level === "custom";
