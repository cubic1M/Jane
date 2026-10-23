// The monthly close (spec step 244): on the first of the month Jane closes the month before.

// The close runs from this day of the month (the person's own date) until it's done.
export const MONTH_CLOSE_DAY = 1;
// Charges whose category Jane isn't sure of: Plaid's catch-all "other" categories, or none,
// not set by the person, from this amount.
export const UNCERTAIN_CATEGORIES: readonly string[] = [
  "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
  "OTHER_OTHER",
];
export const UNCERTAIN_MIN_CENTS = 2_000;
// At most this many are asked about in the one message; the rest are kept as they are.
export const UNCERTAIN_MAX = 5;
// Categories shown in a closed month's figures.
export const CLOSE_TOP_CATEGORIES = 5;
