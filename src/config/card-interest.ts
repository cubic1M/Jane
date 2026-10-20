// Less interest on every card (spec step 224): paying earlier, 0% promotions cleared before
// the interest comes back, and a lower rate asked for. Demo advice; nothing is sent
// without the person's tap.

// A promotion is "off pace" when what the person pays a month is under this share of what
// clearing it by the end needs.
export const PROMO_PACE_SHARE = 0.95;
// Months of card payments that set the pace.
export const PROMO_PACE_MONTHS = 3;
// Deferred interest charges the promo's go-to rate back to the start on what's unpaid.
export const PROMO_SOURCE =
  "https://www.consumerfinance.gov/ask-cfpb/what-is-a-deferred-interest-promotion-en-2181/";

// A rate is worth asking to lower at or above this APR, on a card owing at least this much.
export const RATE_ASK_MIN_APR_BPS = 1_500;
export const RATE_ASK_MIN_BALANCE_CENTS = 20_000;
// The cut the stand-in lender grants when it says yes.
export const RATE_ASK_CUT_BPS = 300;
export const RATE_ANSWER_DAYS = 2;
export const CARD_RATE_PARTNER = "demo";
// Out of 10, how many requests the stand-in grants.
export const DEMO_RATE_GRANT_TENTHS = 6;
// A card with a balance this big pays by the due date, or earlier by this many days, to
// save the interest between.
export const PAY_EARLY_DAYS = 10;
