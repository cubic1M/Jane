import type { PfcDetailed } from "@/categorize/taxonomy";

// --- Paydays (spec step 182, src/detection/paydays.ts) ------------------------------

// A paycheck is a deposit of at least this much that's payroll-like: in one of these
// categories, or named like payroll ("ACME CORP PAYROLL", "DIR DEP"), and never in the
// categories after it. Interest, dividends, refunds and transfers are never a paycheck.
export const PAYCHECK_MIN_CENTS = 10_000;
export const PAYROLL_CATEGORIES: readonly PfcDetailed[] = [
  "INCOME_SALARY",
  "INCOME_MILITARY",
  "INCOME_RETIREMENT_PENSION",
  "INCOME_LONG_TERM_DISABILITY",
  "INCOME_UNEMPLOYMENT",
];
// Plaid's older name for INCOME_SALARY, still on transactions categorized before PFCv2.
export const PAYROLL_LEGACY_CATEGORIES: readonly string[] = ["INCOME_WAGES"];
export const PAYROLL_WORDS: readonly string[] = [
  "payroll",
  "direct deposit",
  "direct dep",
  "dir dep",
  "salary",
  "paycheck",
];
export const NEVER_PAYROLL_CATEGORIES: readonly PfcDetailed[] = [
  "INCOME_INTEREST_EARNED",
  "INCOME_DIVIDENDS",
  "INCOME_TAX_REFUND",
  "INCOME_RENTAL",
  "INCOME_CHILD_SUPPORT",
  "TRANSFER_IN_ACCOUNT_TRANSFER",
  "TRANSFER_IN_SAVINGS",
  "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
  "TRANSFER_IN_TRANSFER_IN_FROM_APPS",
];
// A schedule needs this many paychecks from one employer. At most this share of them may
// fall off the schedule (a bonus, a missed week), and this share of the schedule's dates
// may have no paycheck.
export const PAYDAY_MIN_PAYCHECKS = 3;
export const PAYDAY_OFF_SCHEDULE_SHARE = 0.2;
// A deposit can post this many days off its payday and still count as that payday.
export const PAYDAY_POSTING_DAYS = 1;
// Twice a month: the two paydays are this many days apart at least.
export const SEMI_MONTHLY_MIN_GAP_DAYS = 10;
// How far a weekend or holiday can move a payday, in days.
export const PAYDAY_MAX_SHIFT_DAYS = 3;
// About how many days apart each schedule's paydays are: the step for weekly and every two
// weeks, and the usual gap for "still paid" (with ACTIVE_WITHIN_INTERVALS).
export const PAYDAY_GAP_DAYS = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  SEMI_MONTHLY: 15,
  MONTHLY: 31,
} as const;
// How many paychecks a month each schedule brings, on average (the paycheck split, spec step 206).
export const PAYCHECKS_PER_MONTH = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
} as const;
