import type { FindingType } from "@/generated/prisma/client";
import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";

// Every threshold, rate and multiplier the detection rules use. Tune these during the
// beta; rule code must read them from here, never inline its own numbers.
//
// Category names are Plaid PFCv2 (see src/categorize/taxonomy.ts), checked against
// https://plaid.com/documents/pfc-taxonomy-all.csv on 2026-10-17.

export type ConfidenceLevel = "low" | "medium" | "high";

// How far back rules look at transactions.
export const LOOKBACK_MONTHS = 12;

// The "money found" total counts only findings at or above this confidence.
export const MONEY_FOUND_MIN_CONFIDENCE: ConfidenceLevel = "medium";

// Findings that count toward "money found" only once the user has said yes. A
// subscription is only saved money if the person actually wants it cancelled.
export const COUNT_ONLY_WHEN_APPROVED: readonly FindingType[] = ["subscription_review"];

// A declined finding comes back only when its measured amount moves by more than this.
export const RESURFACE_DECLINED_CHANGE = 0.2;

// --- Recurring charges -------------------------------------------------------------

// Plaid frequencies (plus QUARTERLY, which only our own fallback detects), as charges a year.
export const CHARGES_PER_YEAR = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUALLY: 1,
} as const;

export type Frequency = keyof typeof CHARGES_PER_YEAR;

// Fallback detection, used when we have no Plaid recurring streams: 3+ charges at the same
// merchant, amounts within 10% of each other, every gap inside one of these day ranges.
export const FALLBACK_MIN_CHARGES = 3;
export const FALLBACK_AMOUNT_TOLERANCE = 0.1;
export const FALLBACK_INTERVAL_DAYS: Readonly<
  Partial<Record<Frequency, readonly [min: number, max: number]>>
> = {
  WEEKLY: [6, 8],
  BIWEEKLY: [13, 16],
  MONTHLY: [26, 35],
  QUARTERLY: [84, 98],
};

// A detected stream is still active if its last charge is within this many of its usual
// gaps from today (1.5 monthly gaps = about 45 days).
export const ACTIVE_WITHIN_INTERVALS = 1.5;

// Stream confidence: Plaid's own status, or for our fallback, how many charges we saw.
export const HIGH_CONFIDENCE_MIN_CHARGES = 6;

// --- Subscription review and duplicates --------------------------------------------

// Categories where a recurring charge is almost always a subscription.
export const SUBSCRIPTION_CATEGORIES: readonly PfcDetailed[] = [
  "ENTERTAINMENT_TV_AND_MOVIES",
  "ENTERTAINMENT_MUSIC_AND_AUDIO",
  "ENTERTAINMENT_VIDEO_GAMES",
  "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
  "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
];

// Merchants that are subscriptions whatever their category (matched as whole words in the
// normalized merchant name, lower case).
export const SUBSCRIPTION_MERCHANTS: readonly string[] = [
  "adobe",
  "amazon prime",
  "audible",
  "chatgpt",
  "claude ai",
  "dropbox",
  "duolingo",
  "google one",
  "google storage",
  "icloud",
  "linkedin",
  "microsoft 365",
  "new york times",
  "nytimes",
  "openai",
  "patreon",
  "peloton",
  "wsj",
  "youtube premium",
];

// Categories too broad to say whether a recurring charge is a subscription (a software
// tool, a membership, a box delivery). For these, and for uncategorized charges, Claude is
// asked once per merchant; the subscription rule then treats a "yes" like a known merchant.
export const AMBIGUOUS_SUBSCRIPTION_CATEGORIES: readonly PfcDetailed[] = [
  "ENTERTAINMENT_OTHER_ENTERTAINMENT",
  "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  "GENERAL_SERVICES_EDUCATION",
  "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
  "PERSONAL_CARE_OTHER_PERSONAL_CARE",
  "OTHER_OTHER",
];
// A subscription known only from Claude's answer is never rated above this.
export const LLM_SUBSCRIPTION_MAX_CONFIDENCE: ConfidenceLevel = "medium";

// Groups of interchangeable services. Two or more active subscriptions in one group is a
// duplicate. A stream joins a group by category or by merchant name.
export const SERVICE_GROUPS: readonly {
  id: string;
  label: string;
  categories: readonly PfcDetailed[];
  merchants: readonly string[];
}[] = [
  {
    id: "video_streaming",
    label: "video streaming",
    categories: ["ENTERTAINMENT_TV_AND_MOVIES"],
    merchants: ["youtube premium"],
  },
  {
    id: "music_audio",
    label: "music and audio",
    categories: ["ENTERTAINMENT_MUSIC_AND_AUDIO"],
    merchants: ["audible"],
  },
  {
    id: "gyms",
    label: "gym and fitness",
    categories: ["PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"],
    merchants: ["peloton"],
  },
  {
    id: "cloud_storage",
    label: "cloud storage",
    categories: [],
    merchants: ["dropbox", "google one", "google storage", "icloud"],
  },
  {
    id: "news",
    label: "news",
    categories: ["GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
    merchants: ["new york times", "nytimes", "wsj"],
  },
];

// Services in one group that make a duplicate.
export const DUPLICATE_MIN_SERVICES = 2;
// People often keep two services on purpose, so duplicates never rate above this.
export const DUPLICATE_MAX_CONFIDENCE: ConfidenceLevel = "medium";

// --- Price increase ----------------------------------------------------------------

// Latest charge at least 5% above the average of the charges before it.
export const PRICE_INCREASE_THRESHOLD = 0.05;
// Charges needed before the latest one to call it an increase.
export const PRICE_INCREASE_MIN_PRIOR_CHARGES = 2;
// The earlier charges must all sit within this share of their average: a fixed price, not
// a bill that moves with what you buy.
export const PRICE_INCREASE_MAX_PRIOR_SPREAD = 0.03;
// With at least this many earlier charges the increase is rated high confidence.
export const PRICE_INCREASE_HIGH_CONFIDENCE_PRIOR_CHARGES = 3;
// Spending that varies with what you buy, bills that move with usage, and payments a
// concierge can't negotiate are never "price increases".
export const PRICE_INCREASE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "TRANSPORTATION",
  "TRAVEL",
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
  "BANK_FEES",
  "GOVERNMENT_AND_NON_PROFIT",
];
export const PRICE_INCREASE_EXCLUDED_CATEGORIES: readonly PfcDetailed[] = [
  "RENT_AND_UTILITIES_RENT",
  "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
  "RENT_AND_UTILITIES_WATER",
  "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
];

// --- Bank fees and card interest ---------------------------------------------------

// Fees a bank or card issuer charged. Interest is its own finding (card interest).
export const BANK_FEE_CATEGORIES: readonly PfcDetailed[] = [
  "BANK_FEES_ATM_FEES",
  "BANK_FEES_CASH_ADVANCE",
  "BANK_FEES_FOREIGN_TRANSACTION_FEES",
  "BANK_FEES_INSUFFICIENT_FUNDS",
  "BANK_FEES_LATE_FEES",
  "BANK_FEES_OTHER_BANK_FEES",
  "BANK_FEES_OVERDRAFT_FEES",
];

// Interest on purchases. PFCv2 files cash-advance interest under BANK_FEES_CASH_ADVANCE,
// which the bank fees finding already counts.
export const CARD_INTEREST_CATEGORIES: readonly PfcDetailed[] = ["BANK_FEES_INTEREST_CHARGE"];

// --- Insurance ---------------------------------------------------------------------

export const INSURANCE_CATEGORIES: readonly PfcDetailed[] = ["GENERAL_SERVICES_INSURANCE"];

// --- Idle cash ---------------------------------------------------------------------

// Plaid depository subtypes whose balance can count as idle cash.
export const IDLE_CASH_SUBTYPES: readonly string[] = ["checking", "savings"];
// Keep this many months of average spending as a cushion; only cash above it is idle.
export const IDLE_CASH_MONTHS_OF_SPENDING = 3;
// Ignore excess cash below this (in cents): the yearly difference would be pocket change.
export const IDLE_CASH_MIN_EXCESS_CENTS = 100_000;
// Yearly rates in basis points (100 = 1%). Conservative on purpose: a lowish reference
// high-yield savings rate and a generous guess at what the money earns today.
// Review against current published savings rates before the beta.
export const REFERENCE_HIGH_YIELD_RATE_BPS = 350;
export const ASSUMED_CURRENT_RATE_BPS = 50;
// Spending history needed for medium and high confidence in the monthly average.
export const IDLE_CASH_MEDIUM_CONFIDENCE_MONTHS = 3;
export const IDLE_CASH_HIGH_CONFIDENCE_MONTHS = 6;
// Outflows that move money rather than spend it, left out of average monthly spending.
export const NON_SPENDING_PRIMARIES: readonly PfcPrimary[] = [
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "LOAN_DISBURSEMENTS",
];
export const NON_SPENDING_CATEGORIES: readonly PfcDetailed[] = [
  // Card purchases are already counted on the card itself.
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
];

// --- Cash-flow forecast (low balance ahead) ----------------------------------------

// How far ahead the forecast looks: a month, including the same date next month.
export const FORECAST_DAYS = 31;
// A checking account forecast to dip below this before more income arrives is a risk.
export const LOW_BALANCE_CUSHION_CENTS = 10_000;
// Below zero is high confidence; between zero and the cushion is medium.
export const LOW_BALANCE_HIGH_CONFIDENCE_BELOW_CENTS = 0;
// Plaid depository subtypes the forecast runs for.
export const FORECAST_SUBTYPES: readonly string[] = ["checking"];

// --- Refunds: double charges, charges after cancelling, trial conversions -----------

// Findings where the money comes back once, as a refund, rather than every year. They
// count toward money found like the rest, at MONEY_FOUND_MIN_CONFIDENCE or above.
export const REFUND_FINDING_TYPES: readonly FindingType[] = [
  "duplicate_charge",
  "charge_after_cancel",
  "trial_conversion",
];
// Card networks give roughly 60 days from the statement to dispute a charge, so older
// charges aren't worth chasing.
export const REFUND_MAX_AGE_DAYS = 60;
// A charge this many days or more after we cancelled the merchant is one they shouldn't
// have taken. The grace covers charges that were already on their way.
export const CHARGE_AFTER_CANCEL_GRACE_DAYS = 3;
// A trial starts with a charge this small (in cents): $0 or a $1 card check...
export const TRIAL_MAX_START_CENTS = 100;
// ...and converts when a full charge of at least this much follows...
export const TRIAL_MIN_FULL_CENTS = 500;
// ...this many days later. Fuel pumps and hotels hold $1 and charge the same day, so a
// conversion needs some days in between.
export const TRIAL_MIN_DAYS = 3;
export const TRIAL_MAX_DAYS = 45;
// Where a small hold before the real charge is normal.
export const TRIAL_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "FOOD_AND_DRINK",
  "TRANSPORTATION",
  "TRAVEL",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
];

// --- Alerts (src/detection/alerts.ts) ------------------------------------------------

// Only events this recent raise an alert, so importing a year of history doesn't send a
// year of alerts.
export const ALERT_RECENT_DAYS = 7;
// A charge is unusually large when it is at least this much (in cents)...
export const LARGE_CHARGE_MIN_CENTS = 50_000;
// ...and at least this many times the account's typical (median) charge...
export const LARGE_CHARGE_MEDIAN_MULTIPLE = 5;
// ...judged only once the account has this many charges to compare with.
export const LARGE_CHARGE_MIN_HISTORY = 10;
// Two charges at the same merchant, for the same amount, this many days apart or less
// might be a double charge.
export const DUPLICATE_CHARGE_WINDOW_DAYS = 1;
// Smaller repeats (a second coffee) aren't worth an alert.
export const DUPLICATE_CHARGE_MIN_CENTS = 1_000;
// Where buying the same thing twice in a day is normal, or the "charge" is money moving.
export const DUPLICATE_CHARGE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "FOOD_AND_DRINK",
  "TRANSPORTATION",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
];
// Money moving rather than spent never counts as an unusually large charge.
export const LARGE_CHARGE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
];
