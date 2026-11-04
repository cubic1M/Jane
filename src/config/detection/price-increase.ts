import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";

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
  // Pharmacy and doctor bills follow what was bought or seen, not a price (night QA 10-30: a
  // retiree's "CVS Pharmacy went up from $49.50 to $61.00, could save $138 a year").
  "MEDICAL",
];
export const PRICE_INCREASE_EXCLUDED_CATEGORIES: readonly PfcDetailed[] = [
  "RENT_AND_UTILITIES_RENT",
  "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
  "RENT_AND_UTILITIES_WATER",
  "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
  // A city's utility bill moves with use too (CSV bench, second tuning set: "CITY OF SPRINGFIELD
  // UTILITY BILLING" from $98 to $122 read as a price rise).
  "RENT_AND_UTILITIES_OTHER_UTILITIES",
];
