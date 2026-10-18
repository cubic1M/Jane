import type { PfcDetailed } from "@/categorize/taxonomy";

// Deadlines (spec step 71, src/insights/deadlines.ts): return windows, trials, renewals,
// payments and the person's own dates, in one list with reminders.

// /deadlines shows everything due in the next this-many days.
export const DEADLINE_HORIZON_DAYS = 90;

// How the list is grouped: due within the first this-many days is "This week", within the
// second "This month", the rest "Later". Counted from today, so "This week" is the next 7
// days, not the calendar week.
export const DEADLINE_WEEK_DAYS = 7;
export const DEADLINE_MONTH_DAYS = 30;

// A one-off purchase of at least this much gets a "return by" date.
export const RETURN_MIN_CENTS = 10_000;
// Days most shops allow for a return, when the merchant isn't listed below.
export const RETURN_WINDOW_DAYS = 30;

// Shops with a different usual window, matched as whole words of the merchant key
// (src/data-sources/merchant.ts). These are the published policies for most items; some
// items (electronics, opened goods) are shorter, so the page says to check the receipt.
export const RETURN_WINDOW_OVERRIDES: readonly { merchant: string; days: number }[] = [
  { merchant: "apple", days: 14 },
  { merchant: "best buy", days: 15 },
  { merchant: "target", days: 90 },
  { merchant: "walmart", days: 90 },
  { merchant: "home depot", days: 90 },
  { merchant: "costco", days: 90 },
];

// Purchases that can usually be returned: things bought in shops, not services, food,
// travel or bills.
export const RETURNABLE_CATEGORIES: readonly PfcDetailed[] = [
  "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
  "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
  "GENERAL_MERCHANDISE_DEPARTMENT_STORES",
  "GENERAL_MERCHANDISE_DISCOUNT_STORES",
  "GENERAL_MERCHANDISE_ELECTRONICS",
  "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES",
  "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
  "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
  "GENERAL_MERCHANDISE_PET_SUPPLIES",
  "GENERAL_MERCHANDISE_SPORTING_GOODS",
  "GENERAL_MERCHANDISE_SUPERSTORES",
  "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT_FURNITURE",
  "HOME_IMPROVEMENT_HARDWARE",
];

// A trial whose first small charge (src/config/detection.ts TRIAL_MAX_START_CENTS) hasn't
// been followed by a full one is expected to end this many days after it started. An
// estimate: the page says so.
export const TRIAL_LENGTH_DAYS = 30;

// Reminders (alert type deadline_soon) go out this many days before the date.
export const DEADLINE_REMINDER_DAYS = 3;
// Return windows get more notice: there's a trip to the shop to fit in.
export const RETURN_REMINDER_DAYS = 5;

// Kinds reminded about by another alert already, so deadline_soon leaves them out when Jane
// found them in the transactions or loans: renewals have "Renews soon" and payments "Bill
// due soon". A renewal date from an uploaded policy has no other reminder, so it keeps this
// one.
export const DEADLINE_KINDS_REMINDED_ELSEWHERE: readonly string[] = ["renewal", "payment"];

// Longest title and note for a deadline the person types in.
export const DEADLINE_TITLE_MAX = 120;
export const DEADLINE_NOTE_MAX = 500;
// Hand-entered deadlines can be at most this many years ahead (catches typos like 2206).
export const DEADLINE_MAX_YEARS_AHEAD = 10;
