import type { FindingType } from "@/generated/prisma/client";
import type { PfcPrimary } from "@/categorize/taxonomy";

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
