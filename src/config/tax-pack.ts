import type { PfcDetailed } from "@/categorize/taxonomy";

// The tax-time pack (spec step 72): which categories go in which group, the IRS
// estimated-payment dates and when the reminder alert fires. Organizing only: Jane never
// says what counts or what to pay.

export const CHARITY_CATEGORIES: readonly PfcDetailed[] = ["GOVERNMENT_AND_NON_PROFIT_DONATIONS"];

// Spending people often show their tax preparer, by group. Veterinary care is filed under
// MEDICAL by Plaid but left out here.
export const PREPARER_GROUPS = {
  medical: [
    "MEDICAL_DENTAL_CARE",
    "MEDICAL_EYE_CARE",
    "MEDICAL_NURSING_CARE",
    "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
    "MEDICAL_PRIMARY_CARE",
    "MEDICAL_OTHER_MEDICAL",
  ],
  childcare: ["GENERAL_SERVICES_CHILDCARE"],
  education: ["GENERAL_SERVICES_EDUCATION"],
} as const satisfies Record<string, readonly PfcDetailed[]>;

// Spec step 119: the pack's groups come from the tax tags (src/config/tax.ts TAX_TAGS), which
// start from these categories; work expenses are tagged by the person.
export type PreparerGroup = keyof typeof PREPARER_GROUPS | "work";

// Income from contracting or gig work, totalled by quarter.
export const SELF_EMPLOYED_INCOME_CATEGORIES: readonly PfcDetailed[] = [
  "INCOME_CONTRACTOR",
  "INCOME_GIG_ECONOMY",
];

// Loans whose interest (Plaid Liabilities' ytd_interest_paid, spec step 65) is listed.
export const INTEREST_LOAN_KINDS = ["student", "mortgage"] as const;

// The IRS estimated-payment dates for a tax year: April 15, June 15 and September 15 of the
// year, and January 15 of the next. When a date falls on a weekend or holiday the IRS moves
// it to the next business day; we show the usual date and point to irs.gov for the exact one.
export const ESTIMATED_TAX_DATES: readonly { month: number; day: number; nextYear: boolean }[] = [
  { month: 4, day: 15, nextYear: false },
  { month: 6, day: 15, nextYear: false },
  { month: 9, day: 15, nextYear: false },
  { month: 1, day: 15, nextYear: true },
];

export const IRS_ESTIMATED_TAX_URL =
  "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes";

// The reminder alert is raised this many days before each date, once per date.
export const ESTIMATED_TAX_ALERT_DAYS = 14;

// Until this day of the year (MM-DD, inclusive) the pack opens on last year; after, on this
// year.
export const TAX_PACK_LAST_YEAR_UNTIL = "04-30";

// How many past years can be picked.
export const TAX_PACK_YEARS_BACK = 6;
