import {
  AMBIGUOUS_SUBSCRIPTION_CATEGORIES,
  BILLING_PLATFORM_MERCHANTS,
  FIXED_PRICE_SUBSCRIPTION_EXCLUDED_CATEGORIES,
  FIXED_PRICE_SUBSCRIPTION_EXCLUDED_PRIMARIES,
  FIXED_PRICE_SUBSCRIPTION_FX_SPREAD,
  FIXED_PRICE_SUBSCRIPTION_MAX_CENTS,
  FIXED_PRICE_SUBSCRIPTION_MAX_CONFIDENCE,
  FIXED_PRICE_SUBSCRIPTION_MAX_STEP,
  FIXED_PRICE_SUBSCRIPTION_MIN_CHARGES,
  FIXED_PRICE_SUBSCRIPTION_NOT_WORDS,
  INSURANCE_CATEGORIES,
  LLM_SUBSCRIPTION_MAX_CONFIDENCE,
  NOT_SUBSCRIPTION_PRIMARIES,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_MERCHANTS,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList, lowest, merchantMatches } from "../helpers";
import { isSubscriptionBox, saysPlan, type Stream } from "../streams";
import { median } from "../units";
import { streamEvidence, type Rule } from "./rule";

function isRecurringCost(stream: Stream): boolean {
  return (
    stream.active &&
    stream.annualCostCents !== null &&
    !inList(stream.pfcDetailed, INSURANCE_CATEGORIES)
  );
}

const NOT_A_PLAN = new RegExp(
  `(?<![A-Z0-9])(?:${FIXED_PRICE_SUBSCRIPTION_NOT_WORDS.join("|")})(?![A-Z0-9])`,
);

// A charge whose category can't say, at one price every month (FIXED_PRICE_SUBSCRIPTION_*), that
// isn't a payment on a debt, insurance, a gift or food and drink by its category or its words.
// One price, or one step up to a new one (every charge at the old price before every one at the
// new), by at most FIXED_PRICE_SUBSCRIPTION_MAX_STEP; or every charge near its usual price
// (FIXED_PRICE_SUBSCRIPTION_FX_SPREAD).
function onePriceOrOneStep(amounts: readonly number[]): boolean {
  const changes = amounts.filter((a, i) => i > 0 && a !== amounts[i - 1]).length;
  if (changes === 0) return true;
  if (
    Math.max(...amounts) - Math.min(...amounts) <=
    median([...amounts]) * FIXED_PRICE_SUBSCRIPTION_FX_SPREAD
  ) {
    return true;
  }
  const [first, last] = [amounts[0], amounts[amounts.length - 1]];
  return changes === 1 && last > first && last <= first * (1 + FIXED_PRICE_SUBSCRIPTION_MAX_STEP);
}

export function isFixedPricePlan(stream: Stream): boolean {
  return (
    !inList(stream.pfcPrimary, FIXED_PRICE_SUBSCRIPTION_EXCLUDED_PRIMARIES) &&
    !inList(stream.pfcDetailed, FIXED_PRICE_SUBSCRIPTION_EXCLUDED_CATEGORIES) &&
    !stream.charges.some((c) => NOT_A_PLAN.test(c.description.toUpperCase())) &&
    stream.frequency === "MONTHLY" &&
    (stream.pfcDetailed === null ||
      inList(stream.pfcDetailed, AMBIGUOUS_SUBSCRIPTION_CATEGORIES)) &&
    stream.charges.length >= FIXED_PRICE_SUBSCRIPTION_MIN_CHARGES &&
    onePriceOrOneStep(stream.charges.map((c) => c.amountCents)) &&
    stream.lastAmountCents <= FIXED_PRICE_SUBSCRIPTION_MAX_CENTS
  );
}

// Known only from its one price every month: no name or category says so, and Claude didn't say no.
const onlyByPrice = (stream: Stream, declined: ReadonlySet<string>) =>
  !declined.has(stream.merchantKey) &&
  !isKnownSubscription(stream) &&
  !inList(stream.pfcPrimary, NOT_SUBSCRIPTION_PRIMARIES) &&
  isFixedPricePlan(stream);

// An active recurring charge from a subscription-like category or merchant, billed through an
// app store, or at one price every month where the category can't say. Insurance has its own
// finding.
export function isSubscription(stream: Stream): boolean {
  return isSubscriptionUnless(new Set())(stream);
}

// The same, leaving out the merchants Claude said aren't subscriptions.
export const isSubscriptionUnless =
  (declined: ReadonlySet<string>) =>
  (stream: Stream): boolean =>
    isRecurringCost(stream) && (isKnownSubscription(stream) || onlyByPrice(stream, declined));

// Known by its category, its merchant, its app store or its own words.
function isKnownSubscription(stream: Stream): boolean {
  return (
    !inList(stream.pfcPrimary, NOT_SUBSCRIPTION_PRIMARIES) &&
    (stream.namedPlan === true ||
      inList(stream.pfcDetailed, SUBSCRIPTION_CATEGORIES) ||
      merchantMatches(stream.merchantKey, SUBSCRIPTION_MERCHANTS) ||
      merchantMatches(stream.merchantKey, BILLING_PLATFORM_MERCHANTS) ||
      isSubscriptionBox(stream) ||
      stream.charges.some((c) => saysPlan(c.description)))
  );
}

// A recurring charge whose category can't tell us whether it's a subscription. These are
// the merchants Claude is asked about.
export function isAmbiguousRecurring(stream: Stream): boolean {
  return (
    isRecurringCost(stream) &&
    !isKnownSubscription(stream) &&
    (stream.pfcDetailed === null || inList(stream.pfcDetailed, AMBIGUOUS_SUBSCRIPTION_CATEGORIES))
  );
}

// Savings are the full annual cost: what the person keeps if they cancel. The money-found
// total only counts it once they say yes (COUNT_ONLY_WHEN_APPROVED).
export const subscriptionReview: Rule = (input, streams) => {
  const confirmed = new Set(input.subscriptionMerchantKeys ?? []);
  const declined = new Set(input.declinedSubscriptionMerchantKeys ?? []);
  const found = streams.filter(
    (s) =>
      isSubscriptionUnless(declined)(s) ||
      (isAmbiguousRecurring(s) && confirmed.has(s.merchantKey)),
  );
  // Two plans of one merchant at two prices are told apart by their price (QA round 31: both
  // read "Review your Spotify subscription").
  const named = new Map<string, number>();
  for (const s of found) named.set(s.merchant, (named.get(s.merchant) ?? 0) + 1);
  return found.map((stream) => ({
    type: "subscription_review",
    key: stream.key,
    title:
      (named.get(stream.merchant) ?? 0) > 1
        ? `Review your ${stream.merchant} subscription at ${formatCents(stream.lastAmountCents)}`
        : `Review your ${stream.merchant} subscription`,
    annualSavingsCents: stream.annualCostCents,
    amountCents: stream.annualCostCents,
    // Known by name or category: its own confidence. Claude said yes: up to medium. Only its
    // one price says so: low.
    confidence: isKnownSubscription(stream)
      ? stream.confidence
      : confirmed.has(stream.merchantKey)
        ? lowest(stream.confidence, LLM_SUBSCRIPTION_MAX_CONFIDENCE)
        : lowest(stream.confidence, FIXED_PRICE_SUBSCRIPTION_MAX_CONFIDENCE),
    evidence: streamEvidence(stream),
  }));
};
