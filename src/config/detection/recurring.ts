import type { PfcDetailed } from "@/categorize/taxonomy";

// --- Recurring charges -------------------------------------------------------------

// Plaid frequencies (plus QUARTERLY, which only our own fallback detects), as charges a year.
export const CHARGES_PER_YEAR = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  // Six-month car insurance premiums and property tax paid in two instalments (debugger 10-31).
  SEMIANNUALLY: 2,
  ANNUALLY: 1,
} as const;

export type Frequency = keyof typeof CHARGES_PER_YEAR;
// A plan billed every four weeks to the day ("SQ *ORANGETHEORY 4WK") reads as monthly but comes 13
// times a year: every gap exactly this many days, at least this many gaps (a monthly charge's
// gaps are 28 only into March). CSV bench, second tuning set: the yearly cost was 8% low.
export const FOUR_WEEKLY_GAP_DAYS = 28;
export const FOUR_WEEKLY_MIN_GAPS = 2;
export const FOUR_WEEKLY_CHARGES_PER_YEAR = 13;

// Fallback detection, used when we have no Plaid recurring streams: 3+ charges at the same
// merchant, amounts within 10% of each other, every gap inside one of these day ranges.
export const FALLBACK_MIN_CHARGES = 3;
export const FALLBACK_AMOUNT_TOLERANCE = 0.1;
// Bills that move with use or with what was bought: the gas and power bill, water, and the
// card's monthly payment. Their amount changes every month, so a run of them is found from the
// regular timing alone (accuracy bench: bills' recall was 61%, every utility and card payment
// missed from "Coming up").
export const VARIABLE_BILL_CATEGORIES: readonly PfcDetailed[] = [
  "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
  "RENT_AND_UTILITIES_WATER",
  "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
  "RENT_AND_UTILITIES_OTHER_UTILITIES",
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
];
export const FALLBACK_INTERVAL_DAYS: Readonly<
  Partial<Record<Frequency, readonly [min: number, max: number]>>
> = {
  WEEKLY: [6, 8],
  BIWEEKLY: [13, 16],
  // Twice a month on two set days (the 1st and 15th, the 2nd and 16th): gaps of 13 to 17 days,
  // checked after every two weeks (debugger 11-01: a couple's transfers to joint checking).
  SEMI_MONTHLY: [12, 18],
  MONTHLY: [26, 35],
  QUARTERLY: [84, 98],
  SEMIANNUALLY: [175, 190],
};

// Two charges a month apart are enough where a repeat can only be a bill or a subscription: these
// categories and SUBSCRIPTION_MERCHANTS (accuracy bench: a two-month history had none of its rent,
// phone, power or subscriptions found). Such a run is low confidence.
// A plan paused for a beat and picked up again (a gym's freeze): at most this many gaps of about
// twice the usual one, among at least PAUSE_MIN_REGULAR_GAPS regular gaps, still make a run
// (CSV bench, second tuning set: Crunchyroll and a yoga studio, each skipped one month, were
// missed).
export const PAUSE_MAX_SKIPPED = 1;
export const PAUSE_MIN_REGULAR_GAPS = 2;
// A skipped beat is a gap this many intervals long.
export const PAUSE_GAP_MULTIPLE = 2;
export const SHORT_RUN_MIN_CHARGES = 2;
// Plaid's own streams count only once Plaid has seen this many charges: an EARLY_DETECTION stream
// can rest on one, and a $48 dinner became a $576-a-year monthly bill (beta accuracy, production
// fixtures). Counted in Plaid's list, not in the lookback, so a yearly plan still counts.
export const PLAID_STREAM_MIN_CHARGES = 2;
// ...and only at these gaps: a month, or a quarter (a water bill or insurance paid every three
// months, seen twice in a short history; CSV bench, second tuning set). A week apart is a second
// purchase.
export const SHORT_RUN_FREQUENCIES: readonly Frequency[] = ["MONTHLY", "QUARTERLY"];
// Two charges six months apart are a bill only for a fixed premium at an insurer (a six-month
// car policy): a card paid twice, two estimated tax payments or a quarterly bill with a quarter
// missing look the same and aren't (review 10-31).
export const SEMIANNUAL_SHORT_RUN_CATEGORIES: readonly PfcDetailed[] = [
  "GENERAL_SERVICES_INSURANCE",
];
export const SHORT_RUN_CATEGORIES: readonly PfcDetailed[] = [
  "RENT_AND_UTILITIES_RENT",
  "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
  "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
  "RENT_AND_UTILITIES_TELEPHONE",
  "RENT_AND_UTILITIES_WATER",
  "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
  "RENT_AND_UTILITIES_OTHER_UTILITIES",
  "GENERAL_SERVICES_INSURANCE",
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  "LOAN_PAYMENTS_CAR_PAYMENT",
  "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
  "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  "BANK_FEES_OTHER_BANK_FEES",
  "ENTERTAINMENT_TV_AND_MOVIES",
  "ENTERTAINMENT_MUSIC_AND_AUDIO",
  "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
];
// A run among a merchant's other charges must be at least this share of them; less, and prices
// that only look alike happened to land a month apart (a grocer's bills; accuracy bench).
export const RUN_MIN_SHARE_OF_CHARGES = 0.5;
// A usage bill no rule knows by name ("METRO WATER SERVICES", a power company): no category, one
// charge in each month, on days at most USAGE_BILL_DAY_SPREAD apart, at least USAGE_BILL_MIN_CHARGES
// times, is a bill whose amount moves, like VARIABLE_BILL_CATEGORIES (CSV bench, round 11).
export const USAGE_BILL_MIN_CHARGES = 3;
export const USAGE_BILL_DAY_SPREAD = 5;
// A yearly plan is seen once in a year of history: one charge at a SUBSCRIPTION_MERCHANTS
// merchant in this range (in cents) is its yearly renewal (accuracy bench: every Amazon Prime
// was missed). Smaller is a one-off (a book, a rental); larger is equipment. Low confidence.
export const YEARLY_PLAN_MIN_CENTS = 5_000;
export const YEARLY_PLAN_MAX_CENTS = 50_000;
// ...or a charge that says it is the year's renewal, whoever the company ("COSTCO *ANNUAL
// RENEWAL"; CSV bench, second tuning set). Whole words of the description, lower case.
// ...or a monthly plan that ended, then one charge at the same company worth this many of its
// months: the plan switched to yearly (CSV bench, second tuning set: Amazon Prime $14.99 a month,
// then $139).
export const YEARLY_SWITCH_MIN_MONTHS = 8;
export const YEARLY_SWITCH_MAX_MONTHS = 12.5;
export const YEARLY_RENEWAL_WORDS: readonly string[] = [
  "annual",
  "yearly",
  "renewal",
  "membership",
];
// ...and the merchant is the plan itself: a SUBSCRIPTION_MERCHANTS name, alone or with one of
// these words ("DUOLINGO PLUS"). A longer name is something else the company sells ("ADOBE
// STOCK", "AMAZON PRIME VIDEO"; accuracy bench, first held-out set).
export const YEARLY_PLAN_WORDS: readonly string[] = [
  "plus",
  "premium",
  "membership",
  "annual",
  "yearly",
  "subscription",
  // A plan's tier ("MICROSOFT 365 FAMILY").
  "family",
  "personal",
  "individual",
  "student",
];
// The company's shop, not its plan: a charge whose description has one of these words is goods
// ("PELOTON* APPAREL", $60-$120, read as a yearly Peloton plan; accuracy bench, second held-out
// set). Matched as whole words of the description, lower case.
export const YEARLY_PLAN_GOODS_WORDS: readonly string[] = [
  "apparel",
  "clothing",
  "store",
  "shop",
  "boutique",
  "merch",
  "merchandise",
  "gear",
  "accessories",
  "equipment",
  "gift",
  "gifts",
  "outlet",
];

// A detected stream is still active if its last charge is within this many of its usual
// gaps from today (1.5 monthly gaps = about 45 days).
export const ACTIVE_WITHIN_INTERVALS = 1.5;

// Stream confidence: Plaid's own status, or for our fallback, how many charges we saw.
export const HIGH_CONFIDENCE_MIN_CHARGES = 6;
