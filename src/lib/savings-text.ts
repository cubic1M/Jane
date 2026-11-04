import { REFUND_FINDING_TYPES } from "@/config/detection";
import type { FindingType } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";

// How a finding's dollar estimate reads. Most are yearly savings; refunds are money
// back once.

export const isRefund = (type: FindingType) => REFUND_FINDING_TYPES.includes(type);

// "about $X a year" or "about $X back".
export function savingsPhrase(type: FindingType, cents: number): string {
  return isRefund(type) ? `about ${formatCents(cents)} back` : `about ${formatCents(cents)} a year`;
}

// Whether a card interest finding's yearly figure is from the balance and rate (the engine marks
// it), rather than the interest charges seen, a year's worth: real accounts, uploads.
const fromBalance = (evidence: unknown) =>
  !!evidence &&
  typeof evidence === "object" &&
  (evidence as { interestFrom?: unknown }).interestFrom === "balance";

// The line under a finding's title; `evidence` is the finding's, where the page has it.
// A charge raised only because of its one price: what it costs, which is all Jane knows.
function onlyItsPriceCost(type: FindingType, evidence: unknown): number | null {
  if (type !== "subscription_review" || !evidence || typeof evidence !== "object") return null;
  const e = evidence as { onlyItsPrice?: unknown; annualCostCents?: unknown };
  return e.onlyItsPrice === true && typeof e.annualCostCents === "number"
    ? e.annualCostCents
    : null;
}

export function savingsLine(type: FindingType, cents: number | null, evidence?: unknown): string {
  if (cents === null) {
    const cost = onlyItsPriceCost(type, evidence);
    if (cost !== null) return `Costs about ${formatCents(cost)} a year. Not counted as a saving`;
    return type === "insurance_reshop"
      ? // Read-only beta: the person gets the quotes (debugger 10-30), so not "we find".
        "Savings depend on what other insurers quote"
      : "No dollar estimate for this one";
  }
  if (isRefund(type)) return `Could get back about ${formatCents(cents)}`;
  // Idle cash earns interest; nothing is saved (phone walk: "could save" read oddly).
  if (type === "idle_cash") return `Could earn ${savingsPhrase(type, cents)}`;
  // Card interest worked out at today's balance and rate can be more than the last twelve
  // months' interest beside it ("$1,296 in interest… could save about $1,415"), so it says so;
  // from the charges seen it doesn't (new-user pass: an upload's card, balance unknown, said
  // "at today's balance").
  if (type === "card_interest" && fromBalance(evidence))
    return `Could save ${savingsPhrase(type, cents)} at today's balance`;
  return `Could save ${savingsPhrase(type, cents)}`;
}
