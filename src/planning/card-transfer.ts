import {
  BT_DEFAULT_FEE_MIN_CENTS,
  BT_MAX_MONTHS,
  BT_MIN_SAVING_CENTS,
  BT_PROMO_SLACK_MONTHS,
  HARD_PULL_TEXT,
} from "@/config/debt";
import type { CardOffer } from "@/lib/connectors/card-offers/offer";
import { addMonths } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/percent";
import { shortMonth } from "./balance-transfer";

// A balance transfer to a card offer (connectors roadmap round 15, cards 7.2), at what the person
// can really pay each month, not at whatever would clear it in time (step 113's maths,
// ./balance-transfer.ts). Moving costs the fee, the greater of its percent and its minimum, the
// annual fee for each year it takes, and interest at the intro rate and then the go-to rate (the
// top of its range) on whatever is still owed when the intro ends. Staying costs the card's
// interest at the same payment. Shown only when it saves BT_MIN_SAVING_CENTS and the payment
// clears it within the intro months plus BT_PROMO_SLACK_MONTHS; otherwise it says what payment
// would. Every line with a rate says "intro", when it ends, the go-to APR and the fee together
// (12 CFR 1026.16(g)). Pure.

export type CardTransfer =
  | { show: false; reason: "no_terms" | "never_clears" | "saves_too_little" }
  // The person's payment is too slow for the intro: what it would take instead.
  | { show: false; reason: "too_slow"; paymentCents: number }
  | {
      show: true;
      offer: CardOffer;
      feeCents: number;
      goToAprBps: number;
      promoMonths: number;
      // YYYY-MM-DD.
      promoEndsOn: string;
      monthsToClear: number;
      stayInterestCents: number;
      // Fee, annual fees and interest.
      moveCostCents: number;
      savingCents: number;
      lines: string[];
    };

type Inputs = {
  balanceCents: number;
  aprBps: number;
  // What the person can pay each month.
  payCents: number;
  offer: CardOffer;
  // YYYY-MM-DD.
  asOf: string;
};

// Months to clear and the interest paid, at `rateFor(month)` with `payCents` a month. Null when it
// never clears.
function clear(
  owedCents: number,
  payCents: number,
  rateFor: (month: number) => number,
): { months: number; interestCents: number } | null {
  let owed = owedCents;
  let interest = 0;
  for (let month = 0; month < BT_MAX_MONTHS; month += 1) {
    const charged = Math.round((owed * rateFor(month)) / 10_000 / 12);
    if (charged >= payCents) return null;
    interest += charged;
    owed += charged - payCents;
    if (owed <= 0) return { months: month + 1, interestCents: interest };
  }
  return null;
}

// The transfer fee on this balance: the percent, never under the minimum.
export function transferFeeCents(balanceCents: number, offer: CardOffer): number | null {
  if (offer.transferFeeBps === null) return null;
  const share = Math.round((balanceCents * offer.transferFeeBps) / 10_000);
  return Math.max(share, offer.transferFeeMinCents ?? BT_DEFAULT_FEE_MIN_CENTS);
}

export function scoreCardTransfer({
  balanceCents,
  aprBps,
  payCents,
  offer,
  asOf,
}: Inputs): CardTransfer {
  const feeCents = transferFeeCents(balanceCents, offer);
  const goToAprBps = offer.purchaseAprMaxBps ?? offer.purchaseAprMinBps;
  const promoMonths = offer.introTransferMonths;
  const introAprBps = offer.introTransferAprBps;
  if (
    feeCents === null ||
    goToAprBps === null ||
    !promoMonths ||
    introAprBps === null ||
    balanceCents <= 0 ||
    payCents <= 0
  ) {
    return { show: false, reason: "no_terms" };
  }
  const stay = clear(balanceCents, payCents, () => aprBps);
  const move = clear(balanceCents + feeCents, payCents, (month) =>
    month < promoMonths ? introAprBps : goToAprBps,
  );
  if (!stay || !move) return { show: false, reason: "never_clears" };
  const annualFees = (offer.annualFeeCents ?? 0) * Math.ceil(move.months / 12);
  const moveCostCents = feeCents + annualFees + move.interestCents;
  const savingCents = stay.interestCents - moveCostCents;
  if (move.months > promoMonths + BT_PROMO_SLACK_MONTHS) {
    return {
      show: false,
      reason: "too_slow",
      paymentCents: Math.ceil((balanceCents + feeCents) / promoMonths),
    };
  }
  if (savingCents < BT_MIN_SAVING_CENTS) return { show: false, reason: "saves_too_little" };
  const promoEndsOn = addMonths(asOf, promoMonths);
  const terms = `${formatRate(introAprBps)} intro APR on transfers for ${promoMonths} months, to ${shortMonth(promoEndsOn)}; then ${formatRate(goToAprBps)}${offer.variable ? " variable" : ""} APR; a ${formatCents(feeCents)} transfer fee${offer.annualFeeCents ? ` and a ${formatCents(offer.annualFeeCents)} annual fee` : ", no annual fee"}.`;
  return {
    show: true,
    offer,
    feeCents,
    goToAprBps,
    promoMonths,
    promoEndsOn,
    monthsToClear: move.months,
    stayInterestCents: stay.interestCents,
    moveCostCents,
    savingCents,
    lines: [
      `${offer.cardName}: ${terms}`,
      `Paying ${formatCents(payCents)} a month, it's gone in ${move.months} months and costs ${formatCents(moveCostCents)} with the fees, against ${formatCents(stay.interestCents)} in interest at your ${formatRate(aprBps)} APR: about ${formatCents(savingCents)} less.`,
      HARD_PULL_TEXT,
    ],
  };
}
