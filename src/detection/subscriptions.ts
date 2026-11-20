import { NEXT_CHARGE_WINDOW_DAYS, OWN_ACCOUNT_TRANSFERS, type Frequency } from "@/config/detection";
import { paidCardOnFile, paymentsSeenArriving } from "@/categorize/card-payments";
import { billName, expectedDates, isBillStream } from "./forecast";
import {
  isAmbiguousRecurring,
  isOnlyAGuess,
  isSubscriptionUnless,
} from "./rules/subscription-review";
import { buildStreams, isVariable, type Stream } from "./streams";
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
  // A subscription by category or merchant, or one Claude or the person confirmed.
  subscription: boolean;
  // Only its one price says it might be one: asked about on its card, and listed with the bills
  // (src/detection/rules/subscription-review.ts).
  maybeSubscription: boolean;
  // Rent by its category: paid to a landlord or property company, its name never says "rent"
  // (debugger 11-18: "when is rent due?" didn't find Essex Property Trust).
  rent?: true;
  // A bill that moves with use: its lowest, highest and usual (average) amount over the charges
  // seen, so the chat says a range and not the last bill as the monthly one (walk batch 3's upload
  // S1: "Xcel Energy is $57.49 a month" over bills of $46.60, $38.72 and $57.49). The yearly
  // cost above stays the last bill's, as the pages show it.
  varies?: { lowCents: number; highCents: number; usualCents: number };
};

export function recurringCharges(input: DetectionInput): RecurringCharge[] {
  const confirmed = new Set(input.subscriptionMerchantKeys ?? []);
  const declined = new Set(input.declinedSubscriptionMerchantKeys ?? []);
  const cards = cardsWithCharges(input);
  const arrived = paymentsSeenArriving(input.transactions, input.accounts);
  return (
    buildStreams(input)
      .filter((s) => s.active && s.frequency !== null && s.annualCostCents !== null)
      .filter((s) => isBillStream(s) && !OWN_ACCOUNT_TRANSFERS.includes(s.pfcDetailed ?? ""))
      // Paying a card that's on file isn't a bill of its own: what's bought on it is counted
      // where it's bought (night QA 10-30: "Other regular bills $52,534.88 a year" counted a
      // $1,640/mo Chase card payment beside the NYT and Audible charged to that card).
      .filter((s) => !paysCardOnFile(s, cards, arrived))
      .map((s) => {
        const subscription =
          isSubscriptionUnless(declined)(s) ||
          (isAmbiguousRecurring(s) && confirmed.has(s.merchantKey));
        const guess = subscription && isOnlyAGuess(s, confirmed);
        return {
          key: s.key,
          merchantKey: s.merchantKey,
          merchant: billName(s, input.accounts),
          frequency: s.frequency as Frequency,
          lastAmountCents: s.lastAmountCents,
          lastDate: s.lastDate,
          nextDate:
            expectedDates(s, input.asOf, addDays(input.asOf, NEXT_CHARGE_WINDOW_DAYS))[0] ?? null,
          annualCostCents: s.annualCostCents as number,
          subscription: subscription && !guess,
          maybeSubscription: guess,
          ...(s.pfcDetailed === "RENT_AND_UTILITIES_RENT" ? { rent: true as const } : {}),
          ...varies(s),
        };
      })
      .sort((a, b) => b.annualCostCents - a.annualCostCents || a.merchant.localeCompare(b.merchant))
  );
}

function varies(s: Stream): Pick<RecurringCharge, "varies"> {
  const amounts = s.charges.map((c) => c.amountCents);
  if (amounts.length <= 1 || !isVariable(s.charges)) return {};
  const lowCents = Math.min(...amounts);
  const highCents = Math.max(...amounts);
  if (lowCents === highCents) return {};
  const usualCents = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
  return { varies: { lowCents, highCents, usualCents } };
}

// Cards whose own charges are on file: a card account left empty (its upload removed) counts
// none of what's bought on it, so paying it is still the only sign of that spending.
function cardsWithCharges(input: DetectionInput): DetectionInput["accounts"] {
  const charged = new Set(input.transactions.map((t) => t.accountId));
  return input.accounts.filter((a) => a.type === "credit" && charged.has(a.id));
}

function paysCardOnFile(
  s: Stream,
  accounts: DetectionInput["accounts"],
  arrived: ReadonlySet<string>,
): boolean {
  if (s.pfcDetailed !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return false;
  return (
    accounts.some((a) => a.type === "credit" && a.id === s.accountId) ||
    paidCardOnFile(`${s.charges[0]?.description ?? ""} ${s.merchant}`, accounts) !== null ||
    // A card on file shows its payments arriving, whoever issued it (debugger 11-12).
    s.charges.some((c) => arrived.has(c.id))
  );
}
