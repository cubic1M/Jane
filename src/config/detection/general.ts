import type { FindingType } from "@/generated/prisma/client";

export type ConfidenceLevel = "low" | "medium" | "high";

// How far back rules look at transactions.
export const LOOKBACK_MONTHS = 12;

// An account with less history than this (often 3 months of uploaded statements) has its fee
// and interest findings say the months the data covers, not "the last 12 months", and count
// them at their yearly pace, as src/planning/bank-fees.ts does (overnight upload QA).
export const SHORT_HISTORY_DAYS = 200;

// The "money found" total counts only findings at or above this confidence.
export const MONEY_FOUND_MIN_CONFIDENCE: ConfidenceLevel = "medium";

// Findings that count toward "money found" only once the user has said yes. A
// subscription is only saved money if the person actually wants it cancelled.
export const COUNT_ONLY_WHEN_APPROVED: readonly FindingType[] = ["subscription_review"];

// A declined finding comes back only when its measured amount moves by more than this.
export const RESURFACE_DECLINED_CHANGE = 0.2;

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

// --- Checkup (the report's list of every check Jane ran) -----------------------------------------

// A check says it passed only on at least this many days of statements; under it, "Not enough
// data yet". A month shows a fee, a double charge or a trial that turned paid.
export const CHECKUP_MIN_HISTORY_DAYS = 30;
// Checks on recurring bills (subscriptions, price rises, insurance, phone and internet) need a
// bill to come at least twice, so about two months.
export const CHECKUP_MIN_RECURRING_DAYS = 60;
// A check's span is said in days under this many ("45 days"), in months from it ("3 months").
export const CHECKUP_DAYS_UNTIL_MONTHS = 61;
// How many examples a line's detail names (what it found, the kinds of overlap it checks).
export const CHECKUP_EXAMPLES = 3;
