import {
  INSURANCE_CATEGORIES,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_MERCHANTS,
} from "@/config/detection";
import { inList, merchantMatches } from "../helpers";
import type { Stream } from "../streams";
import { streamEvidence, type Rule } from "./rule";

// An active recurring charge from a subscription-like category or merchant. Insurance has
// its own finding.
export function isSubscription(stream: Stream): boolean {
  return (
    stream.active &&
    stream.annualCostCents !== null &&
    !inList(stream.pfcDetailed, INSURANCE_CATEGORIES) &&
    (inList(stream.pfcDetailed, SUBSCRIPTION_CATEGORIES) ||
      merchantMatches(stream.merchantKey, SUBSCRIPTION_MERCHANTS))
  );
}

// Savings are the full annual cost: what the person keeps if they cancel. The money-found
// total only counts it once they say yes (COUNT_ONLY_WHEN_APPROVED).
export const subscriptionReview: Rule = (_input, streams) =>
  streams.filter(isSubscription).map((stream) => ({
    type: "subscription_review",
    key: stream.key,
    title: `Review your ${stream.merchant} subscription`,
    annualSavingsCents: stream.annualCostCents,
    amountCents: stream.annualCostCents,
    confidence: stream.confidence,
    evidence: streamEvidence(stream),
  }));
