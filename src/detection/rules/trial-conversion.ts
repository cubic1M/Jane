import {
  REFUND_MAX_AGE_DAYS,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_MERCHANTS,
  TRIAL_EXCLUDED_PRIMARIES,
  TRIAL_MAX_DAYS,
  TRIAL_MAX_START_CENTS,
  TRIAL_MIN_DAYS,
  TRIAL_MIN_FULL_CENTS,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { byDate, evidenceOf, inList, inLookback, merchantMatches } from "../helpers";
import { merchantOf } from "../streams";
import type { Candidate, DetectionTransaction } from "../types";
import { daysBetween } from "../units";
import type { Rule } from "./rule";

// A free or $1 trial that turned into a full charge: the merchant's first charge is
// tiny, and the next one, days or weeks later, is the real price. Merchants often refund
// a first charge the person didn't mean to pay. Medium confidence for subscription-like
// merchants; low (not counted in money found) for everything else.
export const trialConversion: Rule = (input) => {
  const groups = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    if (t.amountCents < 0 || inList(t.pfcPrimary, TRIAL_EXCLUDED_PRIMARIES)) continue;
    const merchant = merchantOf(t)?.key;
    if (merchant) groups.set(merchant, [...(groups.get(merchant) ?? []), t]);
  }

  return [...groups.keys()].sort().flatMap((merchantKey): Candidate[] => {
    const [start, full] = (groups.get(merchantKey) ?? []).sort(byDate);
    if (!start || !full) return [];
    const gap = daysBetween(start.date, full.date);
    if (
      start.amountCents > TRIAL_MAX_START_CENTS ||
      full.amountCents < TRIAL_MIN_FULL_CENTS ||
      gap < TRIAL_MIN_DAYS ||
      gap > TRIAL_MAX_DAYS ||
      daysBetween(full.date, input.asOf) > REFUND_MAX_AGE_DAYS
    ) {
      return [];
    }

    const merchant = full.merchantName ?? merchantOf(full)?.name ?? merchantKey;
    const subscriptionLike =
      inList(full.pfcDetailed, SUBSCRIPTION_CATEGORIES) ||
      merchantMatches(merchantKey, SUBSCRIPTION_MERCHANTS);
    return [
      {
        type: "trial_conversion",
        key: `merchant:${merchantKey}`,
        title: `Your ${merchant} trial turned into a ${formatCents(full.amountCents)} charge`,
        annualSavingsCents: full.amountCents,
        amountCents: full.amountCents,
        confidence: subscriptionLike ? "medium" : "low",
        evidence: {
          merchant,
          trialCents: start.amountCents,
          refundCents: full.amountCents,
          charges: [evidenceOf(start), evidenceOf(full)],
        },
      },
    ];
  });
};
