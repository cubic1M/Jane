// The year's money plan (spec step 205): twelve months of targets from every sector.

export const YEAR_PLAN_MONTHS = 12;
// Savings, extra debt payments and investing are flexible: in a month whose margin can't
// carry all of them, they share what's there in this order of priority.
export const FLEX_SECTORS = ["debt", "saving", "investing"] as const;
export type FlexSector = (typeof FLEX_SECTORS)[number];
// Dated amounts that are fixed in their month.
export const FIXED_SECTORS = ["insurance", "taxes", "deadlines"] as const;
export type FixedSector = (typeof FIXED_SECTORS)[number];
export const SECTOR_LABELS: Readonly<Record<FlexSector | FixedSector, string>> = {
  saving: "Saving",
  debt: "Extra debt payments",
  investing: "Investing",
  insurance: "Insurance renewals",
  taxes: "Tax payments",
  deadlines: "Other dated payments",
};
// A deadline counts as a tax payment when its title says so.
export const TAX_TITLE = /\b(?:tax|irs|estimated)\b/i;
// Paydays a month, for per-payday investing.
export const INVESTING_PAYDAYS_PER_MONTH = 2;
