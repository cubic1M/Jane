// Credit on autopilot, round three (spec step 251): the monthly credit check-up. What each item
// is called; the thresholds are the ones each feature already uses (src/config/fit.ts,
// costly-borrowing.ts, car loan add-ons), so the check-up and the pages never disagree.

export const MONTHLY_ITEMS = [
  "soft_checks",
  "rates",
  "addons",
  "costly",
  "rent",
  "card_rate",
] as const;
export type MonthlyItemKey = (typeof MONTHLY_ITEMS)[number];

export const MONTHLY_ITEM_TITLES: Readonly<Record<MonthlyItemKey, string>> = {
  soft_checks: "Rates and what you could borrow",
  rates: "A cheaper rate on a loan",
  addons: "Car loan add-ons",
  costly: "Costly borrowing",
  rent: "Rent and your deposit",
  card_rate: "A lower card rate",
};

// The loans the check-up asks the fit engine to price a refinance for.
export const MONTHLY_REFI_KINDS = ["mortgage", "auto", "student", "personal"] as const;

// A lower-rate request is sent by Jane, at Handle everything, at most once in this many days.
export const MONTHLY_RATE_REQUEST_DAYS = 30;
