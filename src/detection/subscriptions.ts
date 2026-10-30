import { NEXT_CHARGE_WINDOW_DAYS, OWN_ACCOUNT_TRANSFERS, type Frequency } from "@/config/detection";
import { paidCardOnFile } from "@/categorize/card-payments";
import { billName, expectedDates, isBillStream } from "./forecast";
import { isAmbiguousRecurring, isSubscriptionUnless } from "./rules/subscription-review";
import { buildStreams, type Stream } from "./streams";
import type { DetectionInput } from "./types";
import { addDays } from "./units";

// Every recurring charge we see, for /subscriptions, the money hub and the chat (Claude's
// subscriptions tool and the numbers sent with every question): the same streams the
// subscription findings and the bills forecast use, so the yearly costs and next dates agree,
// read the same way as the bills (card interest isn't one; a card payment says so). Money
// moved to the person's own accounts isn't a charge. Pure.

export type RecurringCharge = {
  // The stream key ("merchant:netflix"), which is also the subscription finding's key. A second
  // subscription billed through the same merchant has its price on it ("merchant:apple@1099").
  key: string;
  merchantKey: string;
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
  const declined = new Set(input.declinedSubscriptionMerchantKeys ?? []);
  return (
    buildStreams(input)
      .filter((s) => s.active && s.frequency !== null && s.annualCostCents !== null)
      .filter((s) => isBillStream(s) && !OWN_ACCOUNT_TRANSFERS.includes(s.pfcDetailed ?? ""))
      // Paying a card that's on file isn't a bill of its own: what's bought on it is counted
      // where it's bought (night QA 10-30: "Other regular bills $52,534.88 a year" counted a
      // $1,640/mo Chase card payment beside the NYT and Audible charged to that card).
      .filter((s) => !paysCardOnFile(s, input.accounts))
      .map((s) => ({
        key: s.key,
        merchantKey: s.merchantKey,
        merchant: billName(s, input.accounts),
        frequency: s.frequency as Frequency,
        lastAmountCents: s.lastAmountCents,
        lastDate: s.lastDate,
        nextDate:
          expectedDates(s, input.asOf, addDays(input.asOf, NEXT_CHARGE_WINDOW_DAYS))[0] ?? null,
        annualCostCents: s.annualCostCents as number,
        subscription:
          isSubscriptionUnless(declined)(s) ||
          (isAmbiguousRecurring(s) && confirmed.has(s.merchantKey)),
      }))
      .sort((a, b) => b.annualCostCents - a.annualCostCents || a.merchant.localeCompare(b.merchant))
  );
}

function paysCardOnFile(s: Stream, accounts: DetectionInput["accounts"]): boolean {
  if (s.pfcDetailed !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return false;
  return (
    accounts.some((a) => a.type === "credit" && a.id === s.accountId) ||
    paidCardOnFile(`${s.charges[0]?.description ?? ""} ${s.merchant}`, accounts) !== null
  );
}
