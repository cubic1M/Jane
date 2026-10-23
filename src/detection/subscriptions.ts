import { NEXT_CHARGE_WINDOW_DAYS, OWN_ACCOUNT_TRANSFERS, type Frequency } from "@/config/detection";
import { billName, expectedDates, isBillStream } from "./forecast";
import { isAmbiguousRecurring, isSubscription } from "./rules/subscription-review";
import { buildStreams } from "./streams";
import type { DetectionInput } from "./types";
import { addDays } from "./units";

// Every recurring charge we see, for /subscriptions, the money hub and the chat (Claude's
// subscriptions tool and the numbers sent with every question): the same streams the
// subscription findings and the bills forecast use, so the yearly costs and next dates agree,
// read the same way as the bills (card interest isn't one; a card payment says so). Money
// moved to the person's own accounts isn't a charge. Pure.

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
    .filter((s) => isBillStream(s) && !OWN_ACCOUNT_TRANSFERS.includes(s.pfcDetailed ?? ""))
    .map((s) => ({
      key: s.key,
      merchant: billName(s),
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
