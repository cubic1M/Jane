// Plans that keep up (spec step 101): budget tune-ups on the 1st, goal progress from
// transfers, and the weekly review.

// A month's tune-up is offered from the 1st through this day of the month.
export const TUNE_UP_DAYS = 7;
// A budget is tuned when its usual month (the budget suggestion) differs from it by at
// least this share and this much.
export const TUNE_UP_MIN_SHARE = 0.1;
export const TUNE_UP_MIN_CENTS = 2_000;

// Transfers to savings seen in the last this-many days count toward a goal tracked by hand.
export const GOAL_TRANSFER_DAYS = 30;
export const GOAL_TRANSFER_CATEGORIES: readonly string[] = ["TRANSFER_OUT_SAVINGS"];
export const GOAL_TRANSFER_MIN_CENTS = 1_000;

// The weekly review covers this many days, and is posted on the last day of the person's
// week (Sunday), from this hour in their timezone.
export const REVIEW_DAYS = 7;
export const REVIEW_FROM_HOUR = 17;
