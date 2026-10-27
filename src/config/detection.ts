import type { FindingType } from "@/generated/prisma/client";
import { HIGH_YIELD_SAVINGS_BPS } from "./cash";
import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";
import type { CardBenefitKind, Peril } from "./card-benefits";

// Every threshold, rate and multiplier the detection rules use. Tune these during the
// beta; rule code must read them from here, never inline its own numbers.
//
// Category names are Plaid PFCv2 (see src/categorize/taxonomy.ts), checked against
// https://plaid.com/documents/pfc-taxonomy-all.csv on 2026-10-17.

export type ConfidenceLevel = "low" | "medium" | "high";

// How far back rules look at transactions.
export const LOOKBACK_MONTHS = 12;

// An account with less history than this (often 3 months of uploaded statements) has its fee
// and interest findings say the months the data covers, not "the last 12 months", and card
// interest seen in at least two months counts at its yearly pace (overnight upload QA).
export const SHORT_HISTORY_DAYS = 200;
// Card interest counts at its yearly pace only when it was charged in this many months or more.
export const YEARLY_PACE_MIN_MONTHS = 2;

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
  MONTHLY: [26, 35],
  QUARTERLY: [84, 98],
};

// Two charges a month apart are enough where a repeat can only be a bill or a subscription: these
// categories and SUBSCRIPTION_MERCHANTS (accuracy bench: a two-month history had none of its rent,
// phone, power or subscriptions found). Such a run is low confidence.
export const SHORT_RUN_MIN_CHARGES = 2;
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
// A yearly plan is seen once in a year of history: one charge at a SUBSCRIPTION_MERCHANTS
// merchant in this range (in cents) is its yearly renewal (accuracy bench: every Amazon Prime
// was missed). Smaller is a one-off (a book, a rental); larger is equipment. Low confidence.
export const YEARLY_PLAN_MIN_CENTS = 5_000;
export const YEARLY_PLAN_MAX_CENTS = 50_000;
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

// App stores bill other companies' subscriptions under their own name, each at its own price
// and day ("APPLE.COM/BILL"): a regular charge at one price there is a subscription (accuracy
// bench: 11 people's Apple subscriptions were missed). Not a yearly plan when seen once: an app
// store sells one-off purchases at any price.
export const BILLING_PLATFORM_MERCHANTS: readonly string[] = ["apple", "itunes", "google play"];
// Money paid on a debt or moved between accounts is never a subscription, even under a
// subscription merchant's name ("APPLE CARD PAYMENT").
export const NOT_SUBSCRIPTION_PRIMARIES: readonly PfcPrimary[] = [
  "LOAN_PAYMENTS",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "BANK_FEES",
  "INCOME",
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
// A rise is still news for this many charges at the new price; after that it's just the price.
export const PRICE_INCREASE_MAX_CHARGES_SINCE = 3;
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
// A fee the bank gave back within this many days (same amount, same category) was never paid
// (messy-bank QA: an overdraft fee reversed two days later still counted).
export const FEE_REVERSAL_DAYS = 30;
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

// --- Cover the person already has through a card (spec step 152) ------------------
// Plans people pay for that a card benefit can duplicate, by merchant, with what each
// covers. A plan is only called a duplicate when the card covers all of it
// (src/config/card-benefits.ts) and the person meets the card's condition.
export const COVER_PLANS: readonly {
  kind: CardBenefitKind;
  merchants: readonly string[];
  covers: readonly Peril[];
}[] = [
  {
    kind: "phone",
    merchants: [
      "asurion",
      "verizon protect",
      "total mobile protection",
      "assurant",
      "phone insurance",
    ],
    covers: ["damage", "theft"],
  },
  {
    kind: "rental_car",
    merchants: ["bonzah", "rental cover", "allianz rental", "rentalcover"],
    covers: ["collision", "theft"],
  },
  {
    kind: "extended_warranty",
    merchants: ["extended warranty", "warrantech"],
    covers: ["breakdown"],
  },
  {
    // Travel insurance with medical cover is more than a card gives, so isn't matched.
    kind: "travel",
    merchants: ["trip cancellation"],
    covers: ["trip_cancellation", "trip_delay"],
  },
];
// The categories a card's condition looks for in the person's transactions.
export const PHONE_BILL_CATEGORIES: readonly PfcDetailed[] = ["RENT_AND_UTILITIES_TELEPHONE"];
export const RENTAL_CATEGORIES: readonly PfcDetailed[] = ["TRAVEL_RENTAL_CARS"];
export const TRIP_CATEGORIES: readonly PfcDetailed[] = ["TRAVEL_FLIGHTS", "TRAVEL_LODGING"];
// A duplicate is never more sure than this: the card's terms can change.
export const COVERED_BY_CARD_MAX_CONFIDENCE: ConfidenceLevel = "medium";

// --- Idle cash ---------------------------------------------------------------------

// Plaid depository subtypes whose balance can count as idle cash.
export const IDLE_CASH_SUBTYPES: readonly string[] = ["checking", "savings"];
// Keep this many months of average spending as a cushion; only cash above it is idle.
export const IDLE_CASH_MONTHS_OF_SPENDING = 3;
// Ignore excess cash below this (in cents): the yearly difference would be pocket change.
export const IDLE_CASH_MIN_EXCESS_CENTS = 100_000;
// Yearly rates in basis points (100 = 1%): the high-yield savings rate the cash page shows
// (src/config/cash.ts, one rate everywhere) and a generous guess at what the money earns today.
// Review against current published savings rates before the beta.
export const REFERENCE_HIGH_YIELD_RATE_BPS = HIGH_YIELD_SAVINGS_BPS;
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

// --- Bill negotiation ---------------------------------------------------------------

// Typical monthly prices for bills people can often negotiate down. A recurring bill
// above the top of its range becomes a finding; the estimate is the gap to the top, for
// a year. These are estimates, not quotes. Insurance isn't here: insurance_reshop covers
// it, and fair prices depend too much on the person (car, home, state) for one range.
export const BILL_BENCHMARKS: readonly {
  id: string;
  label: string;
  categories: readonly PfcDetailed[];
  merchants: readonly string[];
  typicalLowCents: number;
  typicalHighCents: number;
  // Where the range comes from. Review against current list prices before the beta.
  source: string;
}[] = [
  {
    id: "phone",
    label: "phone",
    categories: ["RENT_AND_UTILITIES_TELEPHONE"],
    merchants: ["verizon wireless", "t mobile", "at t mobility", "mint mobile", "visible"],
    typicalLowCents: 3_000,
    typicalHighCents: 10_000,
    source:
      "Our estimate (Oct 2026) from major US carriers' published single-line and two-line plan prices, before taxes and device payments.",
  },
  {
    id: "internet_tv",
    label: "internet and TV",
    categories: ["RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
    merchants: ["comcast", "xfinity", "spectrum", "cox communications", "optimum", "directv"],
    typicalLowCents: 5_000,
    typicalHighCents: 12_000,
    source:
      "Our estimate (Oct 2026) from major US providers' published home internet prices, with room for a basic TV package.",
  },
];
// A bill only counts when it's this much (in cents a month) above the typical range, so
// a few cents of tax over the line isn't a finding.
export const BILL_NEGOTIATION_MIN_GAP_CENTS = 1_000;

// --- Alerts (src/detection/alerts.ts) ------------------------------------------------

// Only events this recent raise an alert, so importing a year of history doesn't send a
// year of alerts.
export const ALERT_RECENT_DAYS = 7;
// How far ahead /subscriptions looks for each charge's next date: past a year, so yearly
// charges have one.
export const NEXT_CHARGE_WINDOW_DAYS = 400;
// Yearly and quarterly renewals get a "renews soon" alert this many days ahead (monthly
// charges are too frequent to be news).
export const RENEWAL_ALERT_DAYS = 7;
export const RENEWAL_FREQUENCIES: readonly Frequency[] = ["QUARTERLY", "ANNUALLY"];
// A bill reminder comes this many days before the bill's expected date.
export const BILL_REMINDER_DAYS = 3;
// Recurring charges that aren't bills to pay (books QA): card interest is added to the card's
// balance, which its own payment covers.
// The same for an ATM's fee (overnight upload QA: a student's "Non-Chase Atm Fee" was a $3
// bill every two weeks): it follows taking cash out, it isn't a bill to pay.
export const NOT_BILL_CATEGORIES: readonly string[] = [
  "BANK_FEES_INTEREST_CHARGE",
  "BANK_FEES_ATM_FEES",
];
export const CARD_PAYMENT_NAME = "Credit card payment";
// The payment category for a card or loan, by account type, then subtype (Plaid's detailed
// categories). When the bank reports the due date of every such account, the deadline is the
// one reminder for that payment and the guessed bill reminder is left out (books QA: two
// reminders, with different amounts, for one card payment).
export const PAYMENT_CATEGORY_BY_ACCOUNT: Readonly<Record<string, string>> = {
  credit: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  auto: "LOAN_PAYMENTS_CAR_PAYMENT",
  student: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
  mortgage: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  "home equity": "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  personal: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
};
// A card payment from checking is found by its other side when the card company's name isn't in
// the keyword rules (accuracy bench: "BARCLAYCARD US PAYMENT" was counted as spending and missed
// from "Coming up"): the same amount, out of a bank account, within this many days of the card's
// "payment, thank you".
export const CARD_PAYMENT_MATCH_DAYS = 3;
// Money moved between the person's own accounts (chat QA): saving, investing or into an HSA.
// Never a recurring charge. Payment-app transfers and wires stay: they can be rent to a person.
// Cash taken out at an ATM is the person's own money too (overnight upload QA: "Atm
// Withdrawal, $40 every two weeks" was a bill); the forecast still takes it out of checking.
export const OWN_ACCOUNT_TRANSFERS: readonly string[] = [
  "TRANSFER_OUT_ACCOUNT_TRANSFER",
  "TRANSFER_OUT_SAVINGS",
  "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
  "TRANSFER_OUT_WITHDRAWAL",
];
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
// Two bank fees on one day are the bank's fee schedule (two overdrafts), and the bank fees
// finding already asks for them back (accuracy bench, first held-out set).
export const DUPLICATE_CHARGE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "FOOD_AND_DRINK",
  "TRANSPORTATION",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
];
// ...except a meal: the same restaurant bill this big twice is a double charge, not a second
// coffee (accuracy bench: the family's $68.40 dinner charged on two days was missed).
export const DUPLICATE_CHARGE_MEAL_MIN_CENTS = 3_000;
// A seat each: two or three tickets or fares at one price on one day are a group buying
// together, not a mistake (accuracy bench: every one of the 7 false "Charged twice?" was a pair
// of concert tickets). A real double charge at a ticket seller is missed; the bank's dispute
// still covers it.
export const DUPLICATE_CHARGE_PER_SEAT_CATEGORIES: readonly PfcDetailed[] = [
  "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
  "TRAVEL_FLIGHTS",
  "TRANSPORTATION_PUBLIC_TRANSIT",
];
// Cinemas sell a seat each too, but Plaid files them with streaming services, where a double
// charge is real, so they are known by name (whole words of the merchant; accuracy bench, first
// held-out set: two seats at AMC).
export const DUPLICATE_CHARGE_PER_SEAT_WORDS: readonly string[] = [
  "theatre",
  "theatres",
  "theater",
  "theaters",
  "cinema",
  "cinemas",
  "cineplex",
];
// Money moving rather than spent never counts as an unusually large charge.
export const LARGE_CHARGE_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
];

// --- Spotting the unusual (spec step 208) -------------------------------------------------
// A charge is far above usual for its merchant at this many times the merchant's median...
export const UNUSUAL_MERCHANT_MULTIPLE = 4;
// ...and at least this much, judged once the merchant has this many earlier charges.
export const UNUSUAL_MERCHANT_MIN_CENTS = 7_500;
export const UNUSUAL_MERCHANT_MIN_HISTORY = 3;
// A first charge from a merchant never seen before is unusual at this much or more, once
// the account has at least this many days of history to know "never seen" from.
export const UNUSUAL_NEW_MERCHANT_MIN_CENTS = 25_000;
export const UNUSUAL_NEW_MERCHANT_MIN_HISTORY_DAYS = 60;
// A regular bill is much higher than usual at this share above its earlier average.
export const UNUSUAL_BILL_RISE_SHARE = 0.4;
export const UNUSUAL_BILL_MIN_RISE_CENTS = 3_000;
// ...judged once the bill has at least this many earlier charges.
export const UNUSUAL_BILL_MIN_HISTORY = 2;
// Bill categories (Plaid primary) that count as bills here; subscriptions have the price rise rule.
export const UNUSUAL_BILL_PRIMARIES: readonly string[] = ["RENT_AND_UTILITIES"];
// A refund Jane asked for, still not in the transactions this many days after it was done.
export const UNUSUAL_REFUND_MISSING_DAYS = 14;
// A monthly subscription charged twice within this many days.
export const UNUSUAL_DOUBLE_SUBSCRIPTION_DAYS = 25;
// "This was me" on a charge teaches its merchant: later charges up to this multiple of the
// amount told about stay quiet.
export const UNUSUAL_TAUGHT_MULTIPLE = 2;
// Spec steps 208 and 253: what a small-business owner's profile makes expected, so it isn't
// called unusual: payroll and accounting, supplies, rent and tax payments (detailed categories).
export const UNUSUAL_EXPECTED_FOR_BUSINESS: readonly string[] = [
  "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
  "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
  "RENT_AND_UTILITIES_RENT",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
  "LOAN_PAYMENTS_OTHER_PAYMENT",
];
// Tax payments are due dates, not subscriptions that renew.
export const NON_RENEWING_PRIMARIES: readonly string[] = ["GOVERNMENT_AND_NON_PROFIT"];
// The steps shown when someone says a charge isn't theirs: lock the card first. A stand-in
// until card issuers can be reached through a partner.
export const CARD_LOCK_STEPS: readonly string[] = [
  "Open your card issuer's app or site and lock the card; most have a one-tap lock.",
  "Or call the number on the back of the card and say the charge isn't yours.",
  "Check your other recent charges for anything else you don't recognise.",
  "Ask for a replacement card if you can't be sure the number is safe.",
];
// A merchant counts as charging monthly for the double-charge rule with at least this many
// charges, spaced a median of this many days apart (inclusive range).
export const UNUSUAL_DOUBLE_MIN_CHARGES = 4;
export const UNUSUAL_MONTHLY_GAP_DAYS = { min: 26, max: 35 } as const;

// --- Not a subscription, not a bank fee (spec step 263, from the QA sweep) ---------------------

// A yearly or quarterly payment that is not a subscription renewal: taxes and other government
// payments, loan payments and transfers. They have their own deadlines (the taxes side, the loan
// calendar), so they are never "renews".
export const RENEWAL_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "GOVERNMENT_AND_NON_PROFIT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "INCOME",
  "BANK_FEES",
];
// The names those payments go under, for when the category isn't right.
export const GOVERNMENT_PAYEE =
  /\b(?:dept\.?|department) of revenue\b|\binternal revenue\b|\birs\b|\bus treasury\b|\btax (?:collector|commission|board|authority|payment)\b|\bcounty treasurer\b|\bfranchise tax\b/i;

// A payment processor's or merchant account's fees are a cost of doing business, never a bank
// fee to ask back.
export const PROCESSOR_FEE_PAYEE =
  /\b(?:square|stripe|paypal|shopify|clover|toast|adyen|braintree|authorize\.?net)\b.*\b(?:fees?|processing)\b|\bprocessing fees?\b|\bmerchant (?:services|fees?|account)\b|\bcard processing\b/i;

// Books QA: a typical month. One-off charges (a flood's repairs, a move, a hospital bill) are
// left out of the monthly spending Jane averages and quotes, so one unusual month doesn't make
// every month look like it. A one-off is a charge of at least ONE_OFF_MIN_CENTS and
// ONE_OFF_SHARE of a usual month's spending, in a category where one-offs happen, from a
// merchant with no other charge that size in the history looked at. Bills (rent, insurance,
// taxes, loans, tuition, childcare) are never one-offs, however rarely they come.
export const ONE_OFF_MIN_CENTS = 100_000;
export const ONE_OFF_SHARE = 0.25;
export const ONE_OFF_PRIMARIES: readonly string[] = [
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "TRAVEL",
  "GENERAL_MERCHANDISE",
  "GENERAL_SERVICES",
];
export const ONE_OFF_NEVER_DETAILED: readonly string[] = [
  "GENERAL_SERVICES_INSURANCE",
  "GENERAL_SERVICES_EDUCATION",
  "GENERAL_SERVICES_CHILDCARE",
];
// Another charge from the same merchant of at least this share of the amount makes it recur.
export const ONE_OFF_REPEAT_SHARE = 0.5;

// --- Thin data -----------------------------------------------------------------------

// With fewer months of history than this, a confidence percentage is capped at
// THIN_DATA_MAX_PERCENT plus THIN_DATA_MAX_PER_MONTH a month (53% with one month, 59% with
// three, 65% with five): a short history can't make Jane very sure, however many matches.
export const THIN_DATA_MONTHS = 6;
export const THIN_DATA_MAX_PERCENT = 50;
export const THIN_DATA_MAX_PER_MONTH = 3;

// --- Calibration (docs/accuracy.md) --------------------------------------------------

// Two charges of the same amount at the same place within a day were a double charge about two
// times in three on #766's accuracy bench (two tickets looked just the same). With a seat each
// left out (DUPLICATE_CHARGE_PER_SEAT_*), every one on all three bench sets is right, but the
// bench's doubles are cleaner than a real bank's (two of the same shirt look the same too), so
// "Charged twice?" stays no surer than this until real outcomes say otherwise.
export const DUPLICATE_CHARGE_MAX_PERCENT = 65;
