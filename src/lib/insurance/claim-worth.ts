import {
  CLAIMS_FREE_DISCOUNT,
  CLAIM_CLOSE_CALL_CENTS,
  CLAIM_SURCHARGE,
  CLAIM_SURCHARGE_YEARS,
  type PolicyKind,
} from "@/config/insurance";
import { formatCents } from "@/lib/money";

// Claim or pay yourself? (spec step 199): before a claim, what the insurer would pay after
// the deductible against what a claim typically costs in higher premiums over three years
// and the claims-free discount it puts at risk. The payout and the deductible are facts;
// the three-year comparison and the verdict are demo advice only. Pure.

export type ClaimWorth = {
  kind: PolicyKind;
  event: string | null;
  estimateCents: number;
  deductibleCents: number | null;
  // What the insurer would pay: the estimate less the deductible, never below zero.
  payoutCents: number;
  underDeductible: boolean;
  yearlyPremiumCents: number | null;
  // Extra premium over CLAIM_SURCHARGE_YEARS years, and the claims-free discount lost over
  // the same years; null when the premium isn't known.
  riseCents: number | null;
  discountAtRiskCents: number | null;
  // payout less both: positive means claiming leaves you ahead.
  netCents: number | null;
  verdict: "pay_yourself" | "claim" | "close_call" | "unknown";
};

export function surchargeShare(kind: PolicyKind, event: string | null): number {
  const rule = CLAIM_SURCHARGE[kind];
  return (event ? rule.events?.[event] : undefined) ?? rule.default;
}

export function claimWorth(input: {
  kind: PolicyKind;
  event?: string | null;
  estimateCents: number;
  deductibleCents: number | null;
  yearlyPremiumCents: number | null;
}): ClaimWorth {
  const { kind, estimateCents, deductibleCents, yearlyPremiumCents } = input;
  const event = input.event ?? null;
  const payoutCents = Math.max(0, estimateCents - (deductibleCents ?? 0));
  const underDeductible = deductibleCents !== null && estimateCents <= deductibleCents;
  const riseCents =
    yearlyPremiumCents === null
      ? null
      : Math.round(yearlyPremiumCents * surchargeShare(kind, event) * CLAIM_SURCHARGE_YEARS);
  const discountAtRiskCents =
    yearlyPremiumCents === null
      ? null
      : Math.round(yearlyPremiumCents * (CLAIMS_FREE_DISCOUNT[kind] ?? 0) * CLAIM_SURCHARGE_YEARS);
  const netCents =
    riseCents === null || discountAtRiskCents === null
      ? null
      : payoutCents - riseCents - discountAtRiskCents;
  const verdict: ClaimWorth["verdict"] = underDeductible
    ? "pay_yourself"
    : netCents === null
      ? "unknown"
      : Math.abs(netCents) <= CLAIM_CLOSE_CALL_CENTS
        ? "close_call"
        : netCents > 0
          ? "claim"
          : "pay_yourself";
  return {
    kind,
    event,
    estimateCents,
    deductibleCents,
    payoutCents,
    underDeductible,
    yearlyPremiumCents,
    riseCents,
    discountAtRiskCents,
    netCents,
    verdict,
  };
}

// Pure: the facts, which anyone gets: what the insurer would pay.
export function payoutLine(w: ClaimWorth): string {
  if (w.deductibleCents === null) {
    return `For ${formatCents(w.estimateCents)} of damage I'd need your deductible to say what your insurer would pay: add it on your policy.`;
  }
  return w.underDeductible
    ? `${formatCents(w.estimateCents)} is under your ${formatCents(w.deductibleCents)} deductible, so a claim would pay nothing.`
    : `On ${formatCents(w.estimateCents)} of damage with a ${formatCents(w.deductibleCents)} deductible, your insurer would pay about ${formatCents(w.payoutCents)}.`;
}

// Pure: the three-year comparison and the verdict, demo advice only.
export function adviceLines(w: ClaimWorth): string[] {
  if (
    w.underDeductible ||
    w.riseCents === null ||
    w.discountAtRiskCents === null ||
    w.netCents === null
  ) {
    return w.underDeductible
      ? ["Paying it yourself costs the same and keeps your record clean."]
      : [];
  }
  const discount =
    w.discountAtRiskCents > 0
      ? ` and you'd lose about ${formatCents(w.discountAtRiskCents)} of claims-free discount`
      : "";
  return [
    `Over ${CLAIM_SURCHARGE_YEARS} years a claim typically raises your premium by about ${formatCents(w.riseCents)}${discount}.`,
    w.verdict === "claim"
      ? `That leaves you about ${formatCents(w.netCents)} ahead if you claim.`
      : w.verdict === "close_call"
        ? "That's a close call either way, so it comes down to cash now against a cleaner record."
        : `That leaves you about ${formatCents(-w.netCents)} behind if you claim, so paying it yourself looks cheaper.`,
  ];
}
