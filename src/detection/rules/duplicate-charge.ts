import {
  DUPLICATE_CHARGE_EXCLUDED_PRIMARIES,
  DUPLICATE_CHARGE_MIN_CENTS,
  DUPLICATE_CHARGE_WINDOW_DAYS,
  REFUND_MAX_AGE_DAYS,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { byDate, evidenceOf, inList, inLookback } from "../helpers";
import { merchantOf } from "../streams";
import type { Candidate, DetectionInput, DetectionTransaction } from "../types";
import { daysBetween } from "../units";
import type { Rule } from "./rule";

export type DuplicatePair = { first: DetectionTransaction; second: DetectionTransaction };

const merchantName = (t: DetectionTransaction) =>
  t.merchantName ?? merchantOf(t)?.name ?? t.description;

// Two charges for the same amount at the same merchant on the same account, within
// DUPLICATE_CHARGE_WINDOW_DAYS, that weren't refunded afterwards. Shared with the
// double-charge alert.
export function duplicatePairs(input: DetectionInput): DuplicatePair[] {
  const groups = new Map<string, DetectionTransaction[]>();
  for (const t of inLookback(input)) {
    if (Math.abs(t.amountCents) < DUPLICATE_CHARGE_MIN_CENTS) continue;
    if (inList(t.pfcPrimary, DUPLICATE_CHARGE_EXCLUDED_PRIMARIES)) continue;
    const merchant = merchantOf(t)?.key;
    if (!merchant) continue;
    const key = `${t.accountId}\u0000${merchant}\u0000${Math.abs(t.amountCents)}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const pairs: DuplicatePair[] = [];
  for (const rows of groups.values()) {
    rows.sort(byDate);
    const charges = rows.filter((t) => t.amountCents > 0);
    const refunds = rows.filter((t) => t.amountCents < 0);
    for (let i = 1; i < charges.length; i += 1) {
      const [first, second] = [charges[i - 1], charges[i]];
      if (daysBetween(first.date, second.date) > DUPLICATE_CHARGE_WINDOW_DAYS) continue;
      // The merchant already gave the money back.
      if (refunds.some((r) => r.date >= first.date)) continue;
      pairs.push({ first, second });
    }
  }
  return pairs.sort((a, b) => byDate(a.second, b.second));
}

// A double charge recent enough to dispute. The refund is the second charge.
export const duplicateCharge: Rule = (input) =>
  duplicatePairs(input)
    .filter(({ second }) => daysBetween(second.date, input.asOf) <= REFUND_MAX_AGE_DAYS)
    .map(({ first, second }): Candidate => ({
      type: "duplicate_charge",
      key: `transaction:${second.id}`,
      title: `Charged twice? ${formatCents(second.amountCents)} at ${merchantName(second)}`,
      annualSavingsCents: second.amountCents,
      amountCents: second.amountCents,
      confidence: "medium",
      evidence: {
        merchant: merchantName(second),
        accountId: second.accountId,
        refundCents: second.amountCents,
        charges: [evidenceOf(first), evidenceOf(second)],
      },
    }));
