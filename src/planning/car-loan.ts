import { ADDON_MIN_CENTS, ADDON_RULES, type AddonKind } from "@/config/car-loan";
import { formatCents } from "@/lib/money";

// The car loan you already have (spec step 245). Pure: finding dealer add-ons in payments,
// what cancelling one refunds, the letter to cancel, and what changed in the loan's rates.

export type Tx = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
};

export function addonKindOf(text: string): AddonKind | null {
  // GAP first: "GAP" is a word of its own; a warranty's words may include "service".
  for (const kind of ["gap", "service", "warranty"] as const) {
    if (ADDON_RULES[kind].match.test(text)) return kind;
  }
  return null;
}

export type AddonCandidate = {
  key: string;
  kind: AddonKind;
  name: string;
  paidCents: number;
  startedOn: string;
};

// Payments out (positive amounts) that look like an add-on.
export function addonCandidates(txs: readonly Tx[]): AddonCandidate[] {
  return txs
    .filter((t) => t.amountCents >= ADDON_MIN_CENTS)
    .flatMap((t) => {
      const name = (t.merchantName ?? t.description).trim();
      const kind = addonKindOf(`${t.description} ${t.merchantName ?? ""}`);
      return kind
        ? [{ key: `tx:${t.id}`, kind, name, paidCents: t.amountCents, startedOn: t.date }]
        : [];
    });
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
};

export type Refund = {
  monthsUsed: number;
  monthsLeft: number;
  proRataCents: number;
  feeCents: number;
  refundCents: number;
};

// The unused share of what was paid, less the provider's cancellation fee. Whole months
// used; never below zero, and nothing once the term is over.
export function refundFor(input: {
  kind: AddonKind;
  paidCents: number;
  termMonths: number;
  startedOn: string;
  today: string;
}): Refund {
  const rule = ADDON_RULES[input.kind];
  const monthsUsed = Math.max(0, monthsBetween(input.startedOn, input.today));
  const monthsLeft = Math.max(0, input.termMonths - monthsUsed);
  const proRataCents =
    input.termMonths > 0 ? Math.round((input.paidCents * monthsLeft) / input.termMonths) : 0;
  const feeCents =
    proRataCents === 0
      ? 0
      : Math.min(proRataCents, Math.max(rule.feeCents, Math.round(proRataCents * rule.feeShare)));
  return { monthsUsed, monthsLeft, proRataCents, feeCents, refundCents: proRataCents - feeCents };
}

// The cancellation letter, for the person to send or for the team to send for them.
export function cancellationLetter(input: {
  name: string;
  kind: AddonKind;
  addonName: string;
  paidCents: number;
  startedOn: string;
  termMonths: number;
  refund: Refund;
}): string {
  return [
    `To ${input.addonName}:`,
    "",
    `I'm writing to cancel my ${ADDON_RULES[input.kind].label.replace(/^(?!GAP)\w/, (c) => c.toLowerCase())}, bought on ${input.startedOn} for ${formatCents(input.paidCents)} over ${input.termMonths} months, and to ask for the refund of the unused part.`,
    `${input.refund.monthsLeft} of the ${input.termMonths} months are unused, which I make ${formatCents(input.refund.proRataCents)} before any cancellation fee. Please confirm the cancellation date and the refund amount in writing, and send the refund to me or to my lender, whichever the contract requires.`,
    "",
    "Thank you,",
    input.name || "[Your name]",
  ].join("\n");
}

export type RateChange = "rates_fell" | "score_rose";

// What changed since the last check: the best offer's rate dropped by at least fallBps, or
// the credit band got better. Bands are ordered best first.
export function rateChange(input: {
  lastBestAprBps: number | null;
  bestAprBps: number | null;
  lastBand: string | null;
  band: string;
  bandOrder: readonly string[];
  fallBps: number;
}): RateChange | null {
  if (
    input.lastBestAprBps !== null &&
    input.bestAprBps !== null &&
    input.lastBestAprBps - input.bestAprBps >= input.fallBps
  ) {
    return "rates_fell";
  }
  if (input.lastBand !== null) {
    const was = input.bandOrder.indexOf(input.lastBand);
    const is = input.bandOrder.indexOf(input.band);
    if (was >= 0 && is >= 0 && is < was) return "score_rose";
  }
  return null;
}
