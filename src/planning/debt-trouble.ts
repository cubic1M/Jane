import { DMP_ASSUMED_APR_BPS, TROUBLE_PAYMENT_SHARE } from "@/config/debt-trouble";
import type { Debt } from "@/insights/debts";
import { payoffPlan, type DebtCard } from "./debt";

// When debt is too much (spec step 229). Pure: the share of income going to debt payments,
// and a sketch of a debt management plan from the person's own card balances and payments.

// Monthly debt payments, as a share of the monthly income; null without an income.
export function paymentShare(monthlyPaymentsCents: number, incomeCents: number | null) {
  return incomeCents && incomeCents > 0 ? monthlyPaymentsCents / incomeCents : null;
}

export const overTheLine = (share: number | null) =>
  share !== null && share >= TROUBLE_PAYMENT_SHARE;

export type DmpSketch = {
  cardBalanceCents: number;
  cardPaymentCents: number;
  assumedAprBps: number;
  // Months to clear the cards at the payment now, at today's rates and at the assumed rate.
  monthsNow: number | null;
  monthsAssumed: number;
  interestNowCents: number | null;
  interestAssumedCents: number;
  // What the assumed rate would cut off the interest; 0 when it wouldn't.
  interestCutCents: number;
};

// Cards with a balance, a rate and a payment: kept at their payment, then at the assumed rate.
export function dmpSketch(debts: readonly Debt[]): DmpSketch | null {
  const cards: DebtCard[] = debts.flatMap((d) =>
    d.kind === "card" &&
    (d.balanceCents ?? 0) > 0 &&
    d.aprBps !== null &&
    d.paymentCents !== null &&
    d.paymentCents > 0
      ? [
          {
            id: d.key,
            name: d.name,
            balanceCents: d.balanceCents!,
            aprBps: d.aprBps,
            minimumCents: d.paymentCents,
          },
        ]
      : [],
  );
  if (cards.length === 0) return null;
  const payment = cards.reduce((s, c) => s + c.minimumCents, 0);
  const now = payoffPlan(cards, payment, "avalanche");
  const assumed = payoffPlan(
    cards.map((c) => ({ ...c, aprBps: Math.min(c.aprBps, DMP_ASSUMED_APR_BPS) })),
    payment,
    "avalanche",
  );
  if (!assumed.ok) return null;
  return {
    cardBalanceCents: cards.reduce((s, c) => s + c.balanceCents, 0),
    cardPaymentCents: payment,
    assumedAprBps: DMP_ASSUMED_APR_BPS,
    monthsNow: now.ok ? now.months : null,
    monthsAssumed: assumed.months,
    interestNowCents: now.ok ? now.totalInterestCents : null,
    interestAssumedCents: assumed.totalInterestCents,
    interestCutCents: now.ok ? Math.max(0, now.totalInterestCents - assumed.totalInterestCents) : 0,
  };
}
