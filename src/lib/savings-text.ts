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

// The line under a finding's title.
export function savingsLine(type: FindingType, cents: number | null): string {
  if (cents === null) {
    return type === "insurance_reshop"
      ? "Savings depend on the quotes we find"
      : "No dollar estimate for this one";
  }
  return isRefund(type)
    ? `Could get back about ${formatCents(cents)}`
    : `Could save ${savingsPhrase(type, cents)}`;
}
