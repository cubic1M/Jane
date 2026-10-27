import {
  AMBIGUOUS_SUBSCRIPTION_CATEGORIES,
  BILLING_PLATFORM_MERCHANTS,
  INSURANCE_CATEGORIES,
  LLM_SUBSCRIPTION_MAX_CONFIDENCE,
  NOT_SUBSCRIPTION_PRIMARIES,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_MERCHANTS,
} from "@/config/detection";
import { inList, lowest, merchantMatches } from "../helpers";
import type { Stream } from "../streams";
import { streamEvidence, type Rule } from "./rule";

function isRecurringCost(stream: Stream): boolean {
  return (
    stream.active &&
    stream.annualCostCents !== null &&
    !inList(stream.pfcDetailed, INSURANCE_CATEGORIES)
  );
}

// An active recurring charge from a subscription-like category or merchant, or billed through
// an app store. Insurance has its own finding.
export function isSubscription(stream: Stream): boolean {
  return (
    isRecurringCost(stream) &&
    !inList(stream.pfcPrimary, NOT_SUBSCRIPTION_PRIMARIES) &&
    (inList(stream.pfcDetailed, SUBSCRIPTION_CATEGORIES) ||
      merchantMatches(stream.merchantKey, SUBSCRIPTION_MERCHANTS) ||
      merchantMatches(stream.merchantKey, BILLING_PLATFORM_MERCHANTS))
  );
}

// A recurring charge whose category can't tell us whether it's a subscription. These are
// the merchants Claude is asked about.
export function isAmbiguousRecurring(stream: Stream): boolean {
  return (
    isRecurringCost(stream) &&
    !isSubscription(stream) &&
    (stream.pfcDetailed === null || inList(stream.pfcDetailed, AMBIGUOUS_SUBSCRIPTION_CATEGORIES))
  );
}

// Savings are the full annual cost: what the person keeps if they cancel. The money-found
// total only counts it once they say yes (COUNT_ONLY_WHEN_APPROVED).
export const subscriptionReview: Rule = (input, streams) => {
  const confirmed = new Set(input.subscriptionMerchantKeys ?? []);
  return streams
    .filter((s) => isSubscription(s) || (isAmbiguousRecurring(s) && confirmed.has(s.merchantKey)))
    .map((stream) => ({
      type: "subscription_review",
      key: stream.key,
      title: `Review your ${stream.merchant} subscription`,
      annualSavingsCents: stream.annualCostCents,
      amountCents: stream.annualCostCents,
      confidence: isSubscription(stream)
        ? stream.confidence
        : lowest(stream.confidence, LLM_SUBSCRIPTION_MAX_CONFIDENCE),
      evidence: streamEvidence(stream),
    }));
};
