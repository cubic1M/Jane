import {
  CHARGE_AFTER_CANCEL_GRACE_DAYS,
  CHARGE_AFTER_CANCEL_PRICE_RATIO,
  REFUND_MAX_AGE_DAYS,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { byDate, evidenceOf, inLookback, sumCents } from "../helpers";
import { merchantOf } from "../streams";
import type { Candidate } from "../types";
import { addDays, daysBetween } from "../units";
import type { Rule } from "./rule";

// A merchant kept charging after our team cancelled it. Every charge from the grace
// period on, recent enough to dispute, is owed back. High confidence: we did the
// cancelling ourselves.
export const chargeAfterCancel: Rule = (input) =>
  (input.cancelledMerchants ?? []).flatMap(({ merchantKey, cancelledOn }): Candidate[] => {
    const from = addDays(cancelledOn, CHARGE_AFTER_CANCEL_GRACE_DAYS);
    const atMerchant = inLookback(input).filter(
      (t) => t.amountCents > 0 && merchantOf(t)?.key === merchantKey,
    );
    // What the subscription charged before it was cancelled: a later charge at the merchant that is
    // nothing like it (a one-time purchase) isn't the subscription continuing. Only prices that
    // recurred before the cancel count as the plan's; one unrelated purchase is not a price, and
    // without a recurring price nothing is ruled out.
    const within = (a: number, b: number) =>
      a <= b * CHARGE_AFTER_CANCEL_PRICE_RATIO && a * CHARGE_AFTER_CANCEL_PRICE_RATIO >= b;
    const before = atMerchant.filter((t) => t.date < cancelledOn);
    const prices = before
      .filter((t, i) => before.some((o, j) => j !== i && within(t.amountCents, o.amountCents)))
      .map((t) => t.amountCents);
    const isPlanPrice = (cents: number) =>
      prices.length === 0 || prices.some((p) => within(cents, p));
    const charges = atMerchant
      .filter(
        (t) =>
          t.date >= from &&
          daysBetween(t.date, input.asOf) <= REFUND_MAX_AGE_DAYS &&
          isPlanPrice(t.amountCents),
      )
      .sort(byDate);
    if (charges.length === 0) return [];

    const total = sumCents(charges);
    const first = charges[0]!;
    const merchant = first.merchantName ?? merchantOf(first)?.name ?? merchantKey;
    return [
      {
        type: "charge_after_cancel",
        key: `merchant:${merchantKey}`,
        title: `${merchant} charged you ${formatCents(total)} after you cancelled`,
        annualSavingsCents: total,
        amountCents: total,
        confidence: "high",
        evidence: {
          merchant,
          cancelledOn,
          refundCents: total,
          charges: charges.map(evidenceOf),
        },
      },
    ];
  });
