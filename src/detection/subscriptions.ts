import { NEXT_CHARGE_WINDOW_DAYS, type Frequency } from "@/config/detection";
import { expectedDates } from "./forecast";
import { isAmbiguousRecurring, isSubscription } from "./rules/subscription-review";
import { buildStreams } from "./streams";
import type { DetectionInput } from "./types";
import { addDays } from "./units";

// Every recurring charge we see, for /subscriptions: the same streams the subscription
// findings and the bills forecast use, so the yearly costs and next dates agree. Pure.

export type RecurringCharge = {
  // The stream key ("merchant:netflix"), which is also the subscription finding's key.
  key: string;
  merchant: string;
  frequency: Frequency;
  lastAmountCents: number;
  lastDate: string | null;
  nextDate: string | null;
  annualCostCents: number;
  // A subscription by category or merchant, or one Claude confirmed.
  subscription: boolean;
};

export function recurringCharges(input: DetectionInput): RecurringCharge[] {
  const confirmed = new Set(input.subscriptionMerchantKeys ?? []);
  return buildStreams(input)
    .filter((s) => s.active && s.frequency !== null && s.annualCostCents !== null)
    .map((s) => ({
      key: s.key,
      merchant: s.merchant,
      frequency: s.frequency as Frequency,
      lastAmountCents: s.lastAmountCents,
      lastDate: s.lastDate,
      nextDate:
        expectedDates(s, input.asOf, addDays(input.asOf, NEXT_CHARGE_WINDOW_DAYS))[0] ?? null,
      annualCostCents: s.annualCostCents as number,
      subscription: isSubscription(s) || (isAmbiguousRecurring(s) && confirmed.has(s.merchantKey)),
    }))
    .sort((a, b) => b.annualCostCents - a.annualCostCents || a.merchant.localeCompare(b.merchant));
}
