// Price rises seen before they land (spec step 243): introductory prices ending and plans that
// renew once a year, found in the charges, raised as deadlines a month or more ahead with the
// cheaper choice or a call script.

// Bills that usually start on an introductory price (Plaid's detailed categories).
export const PROMO_CATEGORIES: readonly string[] = [
  "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
  "RENT_AND_UTILITIES_TELEPHONE",
];
// Introductory prices usually last this many months (the first that is still ahead counts).
export const PROMO_MONTHS: readonly number[] = [12, 24];
// A bill counts as new (so it may still be on its intro price) when its first charge came at
// least this many days after the person's data starts; one there from the start may be years old.
export const PROMO_NEW_AFTER_DAYS = 30;
// Charges needed to trust the price is flat (an intro price doesn't move).
export const PROMO_MIN_CHARGES = 6;
// A flat price moves by no more than this between charges.
export const PROMO_FLAT_CENTS = 100;
// What an intro price usually rises by when it ends (ESTIMATE TO VERIFY: internet and phone
// promos commonly end 20% to 60% higher).
export const PROMO_RISE_SHARE = 0.4;
// A price rise is shown from this many days before it lands, and is always raised at least
// PRICE_RISE_LEAD_DAYS ahead, in time to call or switch.
export const PRICE_RISE_WINDOW_DAYS = 75;
export const PRICE_RISE_LEAD_DAYS = 30;
// A plan paid once a year: one charge this many days ago or more, and no other charge from it,
// that is a plan's by detection's own rule (src/detection/streams.ts isYearlyPlanCharge: its
// amount in YEARLY_PLAN_*_CENTS, the plan's name or YEARLY_RENEWAL_WORDS, src/config/detection.ts).
// A category alone is never enough: a movie ticket and a bookstore receipt were taken for plans.
export const ANNUAL_MIN_AGE_DAYS = 300;
// Confidence (percent) when the date is Jane's estimate rather than a stated one.
export const PROMO_CONFIDENCE_CAP = 70;
export const ANNUAL_CONFIDENCE_CAP = 75;

// What to say on the call, by kind.
export const CALL_SCRIPTS = {
  promo_end:
    "Hi, my promotional rate ends soon. I'd like to keep my price, or move to the cheapest plan with the same speed. Other providers near me are offering new-customer prices; what can you do to keep me?",
  annual_renewal:
    "Hi, my plan renews soon. What will it cost, and is there a cheaper plan or a loyalty discount? If not, please turn off auto-renewal.",
} as const;
