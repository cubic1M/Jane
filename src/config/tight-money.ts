// When money is tight (spec step 177): what counts as a shortfall, which bills come first,
// and the requests Jane prepares. Nothing is sent without the person's tap.

// Essentials come first: bills whose payee mentions one of these are paid before anything
// else and are never asked to wait. Housing, utilities, insurance.
export const ESSENTIAL_WORDS = {
  housing: ["rent", "mortgage", "landlord", "property"],
  utilities: [
    "electric",
    "power",
    "pg&e",
    "gas &",
    "water",
    "sewer",
    "internet",
    "xfinity",
    "comcast",
    "verizon",
    "phone",
    "wireless",
  ],
  insurance: ["insurance", "geico", "state farm", "allstate", "progressive", "premium"],
} as const;
export type EssentialGroup = keyof typeof ESSENTIAL_WORDS;

// A card rate at or above this is worth asking to lower.
export const LOWER_RATE_MIN_BPS = 1_500;
// A late fee in the last this-many days is worth asking to have waived.
export const LATE_FEE_LOOKBACK_DAYS = 60;
// How long the stand-in lender takes to answer a request, in days.
export const TIGHT_ANSWER_DAYS = 2;
export const TIGHT_PARTNER = "demo";
// Where the hardship rights are explained.
export const HARDSHIP_SOURCE =
  "https://www.consumerfinance.gov/ask-cfpb/what-can-i-do-if-i-cant-pay-my-credit-card-bill-en-1943/";
// The stand-in lender grants this share of requests (out of 10); the rest are declined.
export const DEMO_GRANT_TENTHS = 7;
