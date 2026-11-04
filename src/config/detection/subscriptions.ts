import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";
import type { ConfidenceLevel } from "./general";

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
  // Software sold by the month above FIXED_PRICE_SUBSCRIPTION_MAX_CENTS (CSV bench, second
  // tuning set: "AUTODESK INC" at $245).
  "autodesk",
  // Work software (debugger 11-02: Figma read 49% sure beside Adobe's 95%, on the same 12 charges).
  "canva",
  "figma",
  "github",
  "grammarly",
  "notion",
  "slack",
  "zoom",
];

// A plan by its own words on the statement, whatever else the company sells: a membership at a
// ride, delivery or warehouse company ("UBER *ONE MEMBERSHIP", "DOORDASH DASHPASS", "LYFT *PINK
// MEMBERSHIP"), or a name ending in "+" ("WALMART+", "INSTACART+", "AMC+"). CSV bench, second
// tuning set: every one of these was missed, its category being rides, food or a superstore.
// Words are matched whole, upper case.
export const PLAN_DESCRIPTION_WORDS: readonly string[] = [
  "MEMBERSHIP",
  "SUBSCRIPTION",
  "DASHPASS",
  "UBER ONE",
  "UBER *ONE",
  "LYFT PINK",
  "LYFT *PINK",
];
export const PLAN_NAME_PLUS = /[A-Z]{3,}\+(?![A-Z0-9])/;

// App stores bill other companies' subscriptions under their own name, each at its own price
// and day ("APPLE.COM/BILL"): a regular charge at one price there is a subscription (accuracy
// bench: 11 people's Apple subscriptions were missed). Not a yearly plan when seen once: an app
// store sells one-off purchases at any price.
export const BILLING_PLATFORM_MERCHANTS: readonly string[] = ["apple", "itunes", "google play"];
// Money paid on a debt or moved between accounts is never a subscription, even under a
// subscription merchant's name ("APPLE CARD PAYMENT").
export const NOT_SUBSCRIPTION_PRIMARIES: readonly PfcPrimary[] = [
  // Nobody cancels a car registration (debugger 11-02: "renewal" in the line made it a subscription).
  "GOVERNMENT_AND_NON_PROFIT",
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
  // A car wash's monthly plan at one price (debugger 11-02: "MISTER CAR WASH UNLIMITED" was missed);
  // repairs and visits come at their own prices, so they don't count as one.
  "GENERAL_SERVICES_AUTOMOTIVE",
  "PERSONAL_CARE_OTHER_PERSONAL_CARE",
  "OTHER_OTHER",
];
// A subscription known only from Claude's answer is never rated above this.
export const LLM_SUBSCRIPTION_MAX_CONFIDENCE: ConfidenceLevel = "medium";
// A charge whose category can't say, at the very same price every month, at least this many
// times and no more than this much, is a subscription even before Claude is asked (CSV bench: on
// the held-out statements, 57 of 63 missed subscriptions were such charges under names no rule
// knows). Rent, loans and bills cost more or move; a same-price monthly charge under $100 is
// almost always a plan. Never rated above FIXED_PRICE_SUBSCRIPTION_MAX_CONFIDENCE.
// ...or every charge within a spread (highest less lowest) of this share of its usual price: a
// plan billed in another currency moves a little with the exchange rate (CSV bench, second tuning
// set: a plan in euros, $20.97 to $21.92, was missed).
export const FIXED_PRICE_SUBSCRIPTION_FX_SPREAD = 0.05;
export const FIXED_PRICE_SUBSCRIPTION_MIN_CHARGES = 3;
export const FIXED_PRICE_SUBSCRIPTION_MAX_CENTS = 10_000;
export const FIXED_PRICE_SUBSCRIPTION_MAX_CONFIDENCE: ConfidenceLevel = "low";
// A plan's price goes up in one step (MUBI $14.99, then $15.99 from a month on); a bill moves
// every month. One step up of at most this share still counts as one price.
export const FIXED_PRICE_SUBSCRIPTION_MAX_STEP = 0.3;
// ...but never a payment on a debt, insurance, a gift or food and drink, by category or by the
// words of the description (QA round 28: a credit union loan payment, Lemonade Insurance, a
// church, a bakery and a tavern, each at one price every month, were called subscriptions).
export const FIXED_PRICE_SUBSCRIPTION_EXCLUDED_PRIMARIES: readonly PfcPrimary[] = [
  "LOAN_PAYMENTS",
  "FOOD_AND_DRINK",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSFER_OUT",
  "RENT_AND_UTILITIES",
];
export const FIXED_PRICE_SUBSCRIPTION_EXCLUDED_CATEGORIES: readonly PfcDetailed[] = [
  "GENERAL_SERVICES_INSURANCE",
];
// Matched as whole words of the description, upper case.
export const FIXED_PRICE_SUBSCRIPTION_NOT_WORDS: readonly string[] = [
  "PAYROLL",
  "GUSTO",
  "PAYCHEX",
  "PMT",
  "PYMT",
  "PAYMENT",
  "LOAN",
  "LENDING",
  "CREDIT UNION",
  "MORTGAGE",
  "INSURANCE",
  "ASSURANCE",
  "CHURCH",
  "MINISTRIES",
  "PARISH",
  "TITHE",
  "DONATION",
  "CHARITY",
  "BAKERY",
  "TAVERN",
  "PUB",
  "BAR",
  "RESTAURANT",
  "CAFE",
];

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
// A charge with no category can be a one-off only at this many usual months of spending: rent by check
// has no category and a new name each month ("CHECK 1042"), so the usual floor would take it out.
// A loan's payment likewise (debugger 11-03): a payoff in one go is a one-off, a new loan's first
// payment isn't.
export const ONE_OFF_UNPLACED_MONTHS = 2;
// A bill of that size that comes a few times a year (tuition, property tax, a yearly premium) is a
// real cost, not a one-off, but it isn't that much every month (debugger 11-03: a student's $4,815
// of tuition read as $2,739 a month on months of $1,011). In the averages it counts across the
// months: at most RARE_BILL_MAX_MONTHS of them, for a merchant charged in at most this share.
export const RARE_BILL_MAX_MONTH_SHARE = 1 / 3;
export const RARE_BILL_MAX_MONTHS = 12;
export const RARE_BILL_DETAILED: readonly string[] = [
  ...ONE_OFF_NEVER_DETAILED,
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
];
