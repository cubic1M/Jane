import { LOOKBACK_MONTHS, type ConfidenceLevel } from "@/config/detection";
import type { DetectionInput, DetectionTransaction, EvidenceTransaction } from "./types";
import { monthsBefore } from "./units";

const ORDER: readonly ConfidenceLevel[] = ["low", "medium", "high"];
const rank = (level: ConfidenceLevel) => ORDER.indexOf(level);

export function atLeast(confidence: ConfidenceLevel, minimum: ConfidenceLevel): boolean {
  return rank(confidence) >= rank(minimum);
}

export function lowest(...levels: ConfidenceLevel[]): ConfidenceLevel {
  return levels.reduce((low, level) => (rank(level) < rank(low) ? level : low));
}

// Transactions strictly inside the last LOOKBACK_MONTHS, so a yearly fee isn't counted twice.
export function inLookback(input: DetectionInput): DetectionTransaction[] {
  const cutoff = monthsBefore(input.asOf, LOOKBACK_MONTHS);
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
