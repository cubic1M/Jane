import {
  GOVERNMENT_PAYEE,
  LOOKBACK_MONTHS,
  PROCESSOR_FEE_PAYEE,
  RENEWAL_EXCLUDED_PRIMARIES,
  type ConfidenceLevel,
} from "@/config/detection";
import type { DetectionInput, DetectionTransaction, EvidenceTransaction } from "./types";
import { statementsEnd } from "@/profile/build";
import { monthsBefore } from "./units";

const ORDER: readonly ConfidenceLevel[] = ["low", "medium", "high"];
const rank = (level: ConfidenceLevel) => ORDER.indexOf(level);

export function atLeast(confidence: ConfidenceLevel, minimum: ConfidenceLevel): boolean {
  return rank(confidence) >= rank(minimum);
}

export function lowest(...levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((low, level) => (rank(level) < rank(low) ? level : low));
}

// Where the statements reach: today, or a few days past an old upload's newest line.
export const dataEnd = (transactions: readonly { date: string }[], asOf: string) =>
  statementsEnd(
    transactions.reduce((max, t) => (t.date > max && t.date <= asOf ? t.date : max), ""),
    asOf,
  );

// Where the last LOOKBACK_MONTHS end: where the data reaches (dataEnd), so an old upload's year
// doesn't lose a day each day it sits ("10 interest charges" became 9; gate C, 11-15). Today for
// current data, and today too when every line is older than the window: data that old says
// nothing about now, and nothing is in it.
export function lookbackEnd(transactions: readonly { date: string }[], asOf: string): string {
  const newest = transactions.reduce(
    (max, t) => (t.date > max && t.date <= asOf ? t.date : max),
    "",
  );
  return newest > monthsBefore(asOf, LOOKBACK_MONTHS) ? dataEnd(transactions, asOf) : asOf;
}

// Transactions strictly inside the last LOOKBACK_MONTHS, so a yearly fee isn't counted twice.
export function inLookback(input: DetectionInput): DetectionTransaction[] {
  const cutoff = monthsBefore(lookbackEnd(input.transactions, input.asOf), LOOKBACK_MONTHS);
  return input.transactions.filter((t) => t.date > cutoff && t.date <= input.asOf);
}

export function evidenceOf(t: DetectionTransaction): EvidenceTransaction {
  return { id: t.id, date: t.date, amountCents: t.amountCents, description: t.description };
}

// Oldest first, ties by id, so evidence is identical on every run.
export function byDate<T extends { date: string; id: string }>(a: T, b: T): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

// Whole-word match of any phrase against a normalized, lower-case merchant key.
export function merchantMatches(merchantKey: string, phrases: readonly string[]): boolean {
  const padded = ` ${merchantKey} `;
  return phrases.some((phrase) => padded.includes(` ${phrase} `));
}

export function sumCents(transactions: { amountCents: number }[]): number {
  return transactions.reduce((sum, t) => sum + t.amountCents, 0);
}

export function inList(value: string | null, list: readonly string[]): boolean {
  return value !== null && list.includes(value);
}

// Spec step 263. A yearly or quarterly charge that is a real subscription: not a tax or other
// government payment, a loan payment or a transfer.
export const isRenewable = (s: { merchant: string; pfcPrimary: string | null }): boolean =>
  !inList(s.pfcPrimary, RENEWAL_EXCLUDED_PRIMARIES) && !GOVERNMENT_PAYEE.test(s.merchant);

// Spec step 263. A payment processor's fees are a business cost, never a bank fee.
export const isProcessorFee = (description: string): boolean =>
  PROCESSOR_FEE_PAYEE.test(description);
