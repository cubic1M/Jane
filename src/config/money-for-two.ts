// Money for two (spec step 242): how a couple runs money together and keeps their own.

// How shared bills split: half each, or by what each earns.
export const SPLIT_RULES = ["even", "income"] as const;
export type SplitRule = (typeof SPLIT_RULES)[number];
// A move out of a shared account of this much or more needs both partners' taps, unless the
// household set its own amount.
export const DEFAULT_BIG_MOVE_CENTS = 100_000;
// The smallest and largest amount a household can set.
export const BIG_MOVE_MIN_CENTS = 10_000;
export const BIG_MOVE_MAX_CENTS = 10_000_000;
// Income is read from this many days of deposits, for the split by income. Only the shares
// are ever shown, never the partner's income.
export const SPLIT_INCOME_DAYS = 90;
// Splitting by income is worth suggesting when it moves either share by this much from half.
export const SPLIT_SUGGEST_GAP_BPS = 1_000;
// The money date: on or after this day of the month, once a month, for both partners.
export const MONEY_DATE_DAY = 1;
// Deposits that are pay from an employer (Plaid's detailed categories).
export const WAGE_CATEGORIES: readonly string[] = ["INCOME_WAGES", "INCOME_SALARY"];
// Shared bills a couple usually splits (Plaid's primary categories), for what a split moves.
export const SHARED_BILL_PRIMARY: readonly string[] = [
  "RENT_AND_UTILITIES",
  "FOOD_AND_DRINK",
  "HOME_IMPROVEMENT",
  "LOAN_PAYMENTS",
];
