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
