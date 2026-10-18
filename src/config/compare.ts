// Comparing options (spec step 76, src/planning/compare.ts).

// Prices checked longer ago than this aren't shown: a stale price can mislead.
export const OPTION_STALE_DAYS = 90;

// An option has to save at least this much in its first year to be worth a switch.
export const OPTION_MIN_SAVING_CENTS = 2_400;

// Options shown besides the pick.
export const COMPARE_RUNNERS_UP = 2;

// What can be compared. Insurance and investments never are: those go through licensed
// partners (spec Phase P).
export const OPTION_KINDS = ["plan", "tier", "savings"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

// Option categories for plans, by bill (BILL_BENCHMARKS ids in src/config/detection.ts).
export const PLAN_CATEGORIES = ["phone", "internet_tv"] as const;
