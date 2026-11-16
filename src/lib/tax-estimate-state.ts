// What this year's tax estimate can say, the one rule Home's Taxes tile and the Taxes page share
// (gate B; debugger 11-16: a Plaid sandbox student with no pay, only $0.84 of interest, read "Not
// enough to estimate yet" on Home and "Your 2026 estimate: $0 back" on Taxes). Pure.
//
// - "refund" / "owed": there's tax, and what's withheld or paid is known.
// - "tax": there's tax; what's withheld isn't known.
// - "no_tax": income under what's taxed, nothing withheld seen (a student with a part-time job).
// - "unknown": nothing to estimate from yet.
export type EstimateState = "refund" | "owed" | "tax" | "no_tax" | "unknown";

export function estimateState(t: {
  totalTaxCents: number;
  incomeCents?: number | null;
  withholdingKnown: boolean;
  refundCents: number;
}): EstimateState {
  if (t.totalTaxCents > 0) {
    if (!t.withholdingKnown) return "tax";
    return t.refundCents >= 0 ? "refund" : "owed";
  }
  return (t.incomeCents ?? 0) > 0 && !t.withholdingKnown ? "no_tax" : "unknown";
}
