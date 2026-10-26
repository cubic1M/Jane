import {
  REVIEW_EVERY_DAYS,
  REVIEW_MIN_GAP_DAYS,
  REVIEW_RAISE_SHARE,
  type ReviewReason,
} from "@/config/debt-review";
import { DAY_MS } from "@/lib/dates";

// The yearly debt review (spec step 230): when one is due. Pure.

const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b) - Date.parse(a)) / DAY_MS);

export type ReviewInput = {
  today: string;
  // The last review's day, the debts then and the paycheck then; null before the first.
  lastOn: string | null;
  lastKeys: readonly string[];
  lastPayCents: number | null;
  // Now.
  keys: readonly string[];
  anyOverdue: boolean;
  payCents: number | null;
};

// Why a review is due, or null. The first one is done as soon as there is a debt; after that,
// once a year, or early (never within REVIEW_MIN_GAP_DAYS of the last) after a payment is
// missed, a new loan appears or a paycheck rises.
export function reviewReason(input: ReviewInput): ReviewReason | null {
  if (input.keys.length === 0) return null;
  if (input.lastOn === null) return "first";
  const since = daysBetween(input.lastOn, input.today);
  if (since >= REVIEW_EVERY_DAYS) return "yearly";
  if (since < REVIEW_MIN_GAP_DAYS) return null;
  if (input.anyOverdue) return "missed_payment";
  if (input.keys.some((k) => !input.lastKeys.includes(k))) return "new_loan";
  if (
    input.lastPayCents !== null &&
    input.payCents !== null &&
    input.payCents >= input.lastPayCents * (1 + REVIEW_RAISE_SHARE)
  ) {
    return "raise";
  }
  return null;
}
