// Giving, done smart (spec step 168). FOR REVIEW, like src/config/tax-rates.ts.
//
// - receiptFromCents: a gift of $250 or more needs a written acknowledgment from the charity
//   to be deducted (IRS Publication 526).
// - from/until (MM-DD): the season Jane brings giving up, before gifts stop counting for the
//   year on December 31.
// - minYearlyCents: giving smaller than this a year isn't worth comparing.
// - bunchYears: years of giving bunched into one in the comparison.
// - minSavingCents: an option saving less than this isn't brought up.

export const GIVING = {
  receiptFromCents: 25_000,
  from: "11-01",
  until: "12-31",
  minYearlyCents: 50_000,
  bunchYears: 2,
  minSavingCents: 2_500,
} as const;

// The donor-advised fund stand-in (spec step 168). There's no partner yet: opening one
// records it, and putting money in is always the person's own transfer.
export const DEMO_DONOR_FUND_NAME = "Demo Giving Fund";
