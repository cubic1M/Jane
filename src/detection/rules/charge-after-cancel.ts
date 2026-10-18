import { CHARGE_AFTER_CANCEL_GRACE_DAYS, REFUND_MAX_AGE_DAYS } from "@/config/detection";
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
    const charges = inLookback(input)
      .filter(
        (t) =>
          t.amountCents > 0 &&
          t.date >= from &&
          daysBetween(t.date, input.asOf) <= REFUND_MAX_AGE_DAYS &&
          merchantOf(t)?.key === merchantKey,
      )
      .sort(byDate);
    if (charges.length === 0) return [];

    const total = sumCents(charges);
    const merchant = charges[0].merchantName ?? merchantOf(charges[0])?.name ?? merchantKey;
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
