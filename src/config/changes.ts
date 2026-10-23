import type { FindingType } from "@/generated/prisma/client";
import {
  PRICE_INCREASE_MAX_PRIOR_SPREAD,
  PRICE_INCREASE_MIN_PRIOR_CHARGES,
  PRICE_INCREASE_THRESHOLD,
} from "./detection";

// Jane notices changes (spec step 97): what counts as a change worth a heads-up. The rules
// are in src/insights/changes.ts; these are their thresholds.

// Only changes seen in the last this-many days are brought up.
export const CHANGE_RECENT_DAYS = 14;

// A regular bill or subscription whose latest charge moved from its steady price by at
// least this share and this much. The charges before it must be steady (within the spread),
// so a bill that always varies (power, water) isn't flagged every month. The same numbers as
// the price-rise finding (docs/feature-audit.md, cluster 10), so a heads-up and its card agree.
export const BILL_CHANGE_MIN_SHARE = PRICE_INCREASE_THRESHOLD;
export const BILL_CHANGE_MIN_CENTS = 100;
export const BILL_CHANGE_MAX_PRIOR_SPREAD = PRICE_INCREASE_MAX_PRIOR_SPREAD;
export const BILL_CHANGE_MIN_PRIOR_CHARGES = PRICE_INCREASE_MIN_PRIOR_CHARGES;
// The steady price is the average of up to this many charges before the latest.
export const BILL_CHANGE_USUAL_CHARGES = 3;

// A new subscription: a regular charge whose first payment is this recent, from someone
// whose history goes back further than that (a fresh import makes everything look new).
export const NEW_SUBSCRIPTION_DAYS = 75;

// Paychecks: deposits in these categories, grouped by employer. Needs this many paychecks
// to know the pattern. Late: no paycheck this many days after the usual gap. Smaller: this
// share below the usual amount (the median of the last few).
export const PAYCHECK_CATEGORIES: readonly string[] = [
  "INCOME_SALARY",
  // Plaid's older name for it.
  "INCOME_WAGES",
];
export const PAYCHECK_MIN_HISTORY = 3;
export const PAYCHECK_LATE_DAYS = 3;
export const PAYCHECK_SMALLER_SHARE = 0.1;
export const PAYCHECK_USUAL_COUNT = 6;

// A category running well above its usual pace this month: spent so far is at least this
// multiple of the usual pace (the average of the last few full months, pro-rated to today)
// and at least this much over it. Early in the month the pace says little, so before this
// day of the month only spending already past a whole usual month counts.
export const PACE_USUAL_MONTHS = 3;
export const PACE_MULTIPLE = 1.5;
export const PACE_MIN_EXTRA_CENTS = 10_000;
export const PACE_MIN_DAY = 7;
// Categories with their own heads-ups (fees) or that aren't really spending choices.
export const PACE_EXCLUDED_CATEGORIES: readonly string[] = [
  "Bank fees and interest",
  "Loan payments",
  "Rent and utilities",
];

// A fee is new when no fee of the same kind and amount was charged in this many days
// before it (a monthly service fee isn't new every month).
export const NEW_FEE_HISTORY_DAYS = 90;

// The findings that act on a change, by the stream key they share: a price rise is a price
// fight, or a reshop or bill negotiation for insurance and bills (these always need a tap).
export const BILL_CHANGE_FINDINGS: readonly FindingType[] = [
  "price_increase",
  "insurance_reshop",
  "bill_negotiation",
];
// A new subscription is the subscription card on the same stream (docs/feature-audit.md,
// cluster 10): one message asks whether they meant to sign up, and offers to cancel.
export const NEW_SUBSCRIPTION_FINDINGS: readonly FindingType[] = ["subscription_review"];

// "What changed?" in the chat lists at most this many.
export const CHANGES_IN_REPLY = 5;
