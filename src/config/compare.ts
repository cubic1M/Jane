// Comparing options (spec step 76, src/planning/compare.ts).

// Prices checked longer ago than this aren't shown: a stale price can mislead.
export const OPTION_STALE_DAYS = 90;
// A savings rate goes stale much sooner: an APY is variable, and Reg DD wants the date it's accurate
// as of to be recent (12 CFR 1030.8, comment 8(c)(2); connectors roadmap round 13). A week, until
// the founders set it.
export const SAVINGS_APY_STALE_DAYS = 7;

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
