import { bankFees } from "./rules/bank-fees";
import { billNegotiation } from "./rules/bill-negotiation";
import { coveredByCard } from "./rules/covered-by-card";
import { cardInterest } from "./rules/card-interest";
import { chargeAfterCancel } from "./rules/charge-after-cancel";
import { duplicateCharge } from "./rules/duplicate-charge";
import { duplicateSubscription } from "./rules/duplicate-subscription";
import { idleCash } from "./rules/idle-cash";
import { insuranceReshop } from "./rules/insurance-reshop";
import { lowBalanceRisk } from "./rules/low-balance-risk";
import { priceIncrease } from "./rules/price-increase";
import type { Rule } from "./rules/rule";
import { subscriptionReview } from "./rules/subscription-review";
import { trialConversion } from "./rules/trial-conversion";
import { buildStreams } from "./streams";
import type { Candidate, DetectionInput } from "./types";

export const RULES: readonly Rule[] = [
  subscriptionReview,
  duplicateSubscription,
  priceIncrease,
  bankFees,
  idleCash,
  insuranceReshop,
  cardInterest,
  lowBalanceRisk,
  duplicateCharge,
  chargeAfterCancel,
  trialConversion,
  billNegotiation,
  coveredByCard,
];

// Pure: same input, same candidates in the same order. If two candidates share a type and
// key (e.g. one merchant billed on two cards), the first one wins.
export function detect(input: DetectionInput): Candidate[] {
  const streams = buildStreams(input);
  const seen = new Set<string>();
  const all = RULES.flatMap((rule) => rule(input, streams)).filter((candidate) => {
    const id = `${candidate.type}\u0000${candidate.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // Spec step 263: a group finding ("you pay for 2 video streaming services") already holds the
  // money of the subscriptions it names, so a single "review your Netflix" for one of them would
  // count the same dollars twice in the total. The group is the one to act on.
  const grouped = new Set(
    all
      .filter((c) => c.type === "duplicate_subscription")
      .flatMap((c) =>
        Array.isArray(c.evidence.streamKeys) ? (c.evidence.streamKeys as string[]) : [],
      ),
  );
  return all.filter((c) => !(c.type === "subscription_review" && grouped.has(c.key)));
}
