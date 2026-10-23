import {
  PRODUCT_FOR_DEBT,
  REFI_CARD_TERM_MONTHS,
  REFI_MIN_SAVING_CENTS,
  REFI_PREFER_FIXED,
  REFI_RUNNERS_UP,
  type LoanProduct,
} from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import type { LoanOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { payoffPlan } from "./debt";

// Refinance offers compared (spec step 111): for one debt, what keeping it costs over its
// remaining term against what each offer would cost over the same term, fees included.
// The same month-by-month interest as the debt planner (./debt.ts). The pick is the lowest
// total cost; it's only worth bringing up when it saves REFI_MIN_SAVING_CENTS. Pure.

const BASIS_POINTS = 10_000;

// The level monthly payment that pays `balance` off in `months` at `aprBps`, to the cent
// (rounded up, so the last payment is never short).
export function levelPaymentCents(balanceCents: number, aprBps: number, months: number): number {
  if (months <= 0) return balanceCents;
  const r = aprBps / BASIS_POINTS / 12;
  if (r === 0) return Math.ceil(balanceCents / months);
  return Math.ceil((balanceCents * r) / (1 - (1 + r) ** -months));
}

// Everything paid to clear `balance` with that payment, month by month like the planner.
export function totalPaidCents(balanceCents: number, aprBps: number, months: number): number {
  const payment = levelPaymentCents(balanceCents, aprBps, months);
  const plan = payoffPlan(
    [{ id: "loan", name: "loan", balanceCents, aprBps, minimumCents: payment }],
    payment,
    "avalanche",
  );
  return plan.ok ? plan.totalPaidCents : payment * months;
}

const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

// The months left on a debt: to its payoff date, or for a loan without one, at its
// payment; a card has none, so its offers are compared over REFI_CARD_TERM_MONTHS.
export function remainingMonths(debt: Debt, asOf: string): number | null {
  if (debt.kind === "card") return REFI_CARD_TERM_MONTHS;
  if (debt.payoffDate) {
    const months = monthsBetween(asOf, debt.payoffDate);
    return months > 0 ? months : null;
  }
  if (debt.balanceCents === null || debt.aprBps === null || debt.paymentCents === null) return null;
  const plan = payoffPlan(
    [
      {
        id: "d",
        name: "d",
        balanceCents: debt.balanceCents,
        aprBps: debt.aprBps,
        minimumCents: debt.paymentCents,
      },
    ],
    debt.paymentCents,
    "avalanche",
  );
  return plan.ok ? plan.months : null;
}

// What can be refinanced: a loan or card with a balance, a rate and a term to compare over.
export function refinanceable(
  debt: Debt,
  asOf: string,
): { product: LoanProduct; termMonths: number } | null {
  const product = PRODUCT_FOR_DEBT[debt.kind];
  if (!product || !debt.balanceCents || debt.aprBps === null) return null;
  const termMonths = remainingMonths(debt, asOf);
  return termMonths ? { product, termMonths } : null;
}

export type ScoredOffer = {
  offer: LoanOffer;
  monthlyCents: number;
  // Over the same term, the fee included.
  totalCents: number;
  savingCents: number;
  // Months until the monthly saving has paid the fee back; null with no fee or no saving.
  breakEvenMonths: number | null;
};

export type RefinanceComparison = {
  debtKey: string;
  debtName: string;
  product: LoanProduct;
  termMonths: number;
  balanceCents: number;
  currentAprBps: number;
  // Keeping it: the level payment over the same months, and everything paid.
  currentMonthlyCents: number;
  currentTotalCents: number;
  // Lowest total cost first.
  offers: ScoredOffer[];
  // The cheapest that saves at least REFI_MIN_SAVING_CENTS, fixed rates first.
  pick: ScoredOffer | null;
  runnersUp: ScoredOffer[];
  // Why the pick, in at most three lines.
  why: string[];
  // Paying it off from spare cash saves this much, more than any loan: no loan is picked
  // (src/lib/refinance-cash.ts). Absent when not looked at.
  cashPayoffCents?: number | null;
  // Why a lender would likely turn the person down for it (their score, their debt payments),
  // from the fit engine: no pick is made. Absent when not looked at.
  turnedDown?: string | null;
};

export function compareRefinance(
  debt: Debt,
  offers: readonly LoanOffer[],
  asOf: string,
): RefinanceComparison | null {
  const what = refinanceable(debt, asOf);
  if (!what) return null;
  const balanceCents = debt.balanceCents!;
  const currentAprBps = debt.aprBps!;
  const { termMonths } = what;
  const currentMonthlyCents = levelPaymentCents(balanceCents, currentAprBps, termMonths);
  const currentTotalCents = totalPaidCents(balanceCents, currentAprBps, termMonths);
  const scored = offers
    // Each offer's rate over the debt's own remaining months, whatever term it was quoted at
    // (a month's payments may have passed since): the same term on both sides.
    .filter((o) => o.product === what.product)
    .map((offer): ScoredOffer => {
      const monthlyCents = levelPaymentCents(balanceCents, offer.aprBps, termMonths);
      const totalCents = totalPaidCents(balanceCents, offer.aprBps, termMonths) + offer.feeCents;
      const monthlySaving = currentMonthlyCents - monthlyCents;
      return {
        offer,
        monthlyCents,
        totalCents,
        savingCents: currentTotalCents - totalCents,
        breakEvenMonths:
          offer.feeCents > 0 && monthlySaving > 0
            ? Math.ceil(offer.feeCents / monthlySaving)
            : null,
      };
    })
    .sort((a, b) => a.totalCents - b.totalCents || a.offer.lender.localeCompare(b.offer.lender));
  const enough = scored.filter((o) => o.savingCents >= REFI_MIN_SAVING_CENTS);
  const pick =
    (REFI_PREFER_FIXED ? enough.find((o) => o.offer.rateType === "fixed") : undefined) ??
    enough[0] ??
    null;
  const cheapest = pick !== null && pick !== scored[0];
  const why = pick
    ? [
        `The lowest total cost${cheapest ? " at a fixed rate" : ""} over the same ${termMonths} months: ${formatCents(pick.savingCents)} less, fees included.`,
        `${formatRate(pick.offer.aprBps)} ${pick.offer.rateType} instead of ${formatRate(currentAprBps)}, so the payment goes from ${formatCents(currentMonthlyCents)} to ${formatCents(pick.monthlyCents)} a month${cheapest ? "; a variable rate could go up" : ""}.`,
        pick.offer.feeCents === 0
          ? "No fee to pay up front."
          : pick.breakEvenMonths !== null
            ? `The ${formatCents(pick.offer.feeCents)} fee is paid back by the lower payment in ${pick.breakEvenMonths} ${pick.breakEvenMonths === 1 ? "month" : "months"}.`
            : `It has a ${formatCents(pick.offer.feeCents)} fee, already counted above.`,
      ]
    : [];
  return {
    debtKey: debt.key,
    debtName: debt.name,
    product: what.product,
    termMonths,
    balanceCents,
    currentAprBps,
    currentMonthlyCents,
    currentTotalCents,
    offers: scored,
    pick,
    runnersUp: pick ? scored.filter((o) => o !== pick).slice(0, REFI_RUNNERS_UP) : [],
    why,
  };
}
