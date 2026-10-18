import { bankFees } from "./rules/bank-fees";
import { cardInterest } from "./rules/card-interest";
import { duplicateSubscription } from "./rules/duplicate-subscription";
import { idleCash } from "./rules/idle-cash";
import { insuranceReshop } from "./rules/insurance-reshop";
import { priceIncrease } from "./rules/price-increase";
import type { Rule } from "./rules/rule";
import { subscriptionReview } from "./rules/subscription-review";
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
];

// Pure: same input, same candidates in the same order. If two candidates share a type and
// key (e.g. one merchant billed on two cards), the first one wins.
export function detect(input: DetectionInput): Candidate[] {
  const streams = buildStreams(input);
  const seen = new Set<string>();
  return RULES.flatMap((rule) => rule(input, streams)).filter((candidate) => {
    const id = `${candidate.type}\u0000${candidate.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
