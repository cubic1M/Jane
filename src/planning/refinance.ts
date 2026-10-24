import {
  PRODUCT_FOR_DEBT,
  REFI_CARD_TERM_MONTHS,
  REFI_TERM_RANGE_MONTHS,
  REFI_MIN_SAVING_CENTS,
  REFI_PREFER_FIXED,
  REFI_RUNNERS_UP,
  type LoanProduct,
} from "@/config/debt";
import { loanPaymentCents, type Debt } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import type { LoanOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { payoffPlan } from "./debt";

// Refinance offers compared (spec step 111): for one debt, what keeping it costs (paying what
// the person pays now until it's gone, the same as the fit engine's "keep") against what each
// offer would cost over the debt's own remaining months, fees included (loans QA: one horizon
// for this page, the options card and the chat, so the same saving shows everywhere).
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

// Paying a debt at its payment (loanPaymentCents: one figure for every page): the months
// and everything paid until it's gone. Null when there's no payment or it doesn't pay the
// debt off.
function atPayment(debt: Debt): { payment: number; months: number; totalCents: number } | null {
  const payment = loanPaymentCents(debt);
  if (!payment || debt.balanceCents === null || debt.aprBps === null) return null;
  const plan = payoffPlan(
    [
      {
        id: "d",
        name: "d",
        balanceCents: debt.balanceCents,
        aprBps: debt.aprBps,
        minimumCents: payment,
      },
    ],
    payment,
    "avalanche",
  );
  return plan.ok ? { payment, months: plan.months, totalCents: plan.totalPaidCents } : null;
}

// The months left on a loan: at its payment, else to its payoff date; a card has none, so
// its offers are compared over REFI_CARD_TERM_MONTHS.
export function remainingMonths(debt: Debt, asOf: string): number | null {
  if (debt.kind === "card") return REFI_CARD_TERM_MONTHS;
  const paid = atPayment(debt);
  if (paid) return paid.months;
  if (!debt.payoffDate) return null;
  const months = monthsBetween(asOf, debt.payoffDate);
  return months > 0 ? months : null;
}

// Keeping a debt: its payment each month and everything paid until it's gone. At the payment
// the bank reports, the same "your payment" every page shows (a card at its minimum can take
// years); else a level payment to the loan's payoff date.
export type KeepPath = { monthlyCents: number; months: number; totalCents: number };

export function keepPath(debt: Debt, asOf: string): KeepPath | null {
  if (!debt.balanceCents || debt.aprBps === null) return null;
  const paid = atPayment(debt);
  if (paid) return { monthlyCents: paid.payment, months: paid.months, totalCents: paid.totalCents };
  const months = remainingMonths(debt, asOf);
  if (!months) return null;
  return {
    monthlyCents: levelPaymentCents(debt.balanceCents, debt.aprBps, months),
    months,
    totalCents: totalPaidCents(debt.balanceCents, debt.aprBps, months),
  };
}

// What can be refinanced: a loan or card with a balance and a rate, the months a new loan is
// priced over (the debt's own remaining months, inside the terms lenders offer), and what
// keeping it costs.
export function refinanceable(
  debt: Debt,
  asOf: string,
): { product: LoanProduct; termMonths: number; keep: KeepPath } | null {
  const product = PRODUCT_FOR_DEBT[debt.kind];
  if (!product) return null;
  const keep = keepPath(debt, asOf);
  if (!keep) return null;
  const range = REFI_TERM_RANGE_MONTHS[product];
  const termMonths = Math.min(range.max, Math.max(range.min, keep.months));
  return { product, termMonths, keep };
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
  // Keeping it: what is paid each month now, the months until it's gone, and everything paid.
  currentMonthlyCents: number;
  keepMonths: number;
  currentTotalCents: number;
  // Lowest total cost first.
  offers: ScoredOffer[];
  // The cheapest that saves at least REFI_MIN_SAVING_CENTS, fixed rates first.
  pick: ScoredOffer | null;
  runnersUp: ScoredOffer[];
  // A mortgage: the escrow in its payment, which a refinance doesn't change. Then
  // currentMonthlyCents (like every offer's payment) is principal and interest only.
  escrowCents?: number;
  // Why the pick, in at most three lines.
  why: string[];
  // Paying it off from spare cash saves this much, more than any loan: no loan is picked
  // (src/lib/refinance.ts, the fit engine's verdict). Absent when not looked at.
  cashPayoffCents?: number | null;
  // Why a lender would likely turn the person down for it (their score, their debt payments),
  // from the fit engine: no pick is made. Absent when not looked at.
  turnedDown?: string | null;
};

// `pickLender`: the fit engine's pick when it was asked (src/lib/refinance.ts keeps its verdict),
// so this page and the options card name the same loan; null when it picked none; absent to
// pick here, by the same rule (the cheapest that saves enough, fixed rates first).
export function compareRefinance(
  debt: Debt,
  offers: readonly LoanOffer[],
  asOf: string,
  pickLender?: string | null,
): RefinanceComparison | null {
  const what = refinanceable(debt, asOf);
  if (!what) return null;
  const balanceCents = debt.balanceCents!;
  const currentAprBps = debt.aprBps!;
  const { termMonths, keep } = what;
  const currentMonthlyCents = keep.monthlyCents;
  const currentTotalCents = keep.totalCents;
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
    pickLender === null
      ? null
      : pickLender !== undefined
        ? (scored.find((o) => o.offer.lender === pickLender) ?? null)
        : ((REFI_PREFER_FIXED ? enough.find((o) => o.offer.rateType === "fixed") : undefined) ??
          enough[0] ??
          null);
  const cheapest = pick !== null && pick !== scored[0];
  const why = pick
    ? [
        `The lowest total cost${cheapest ? " at a fixed rate" : ""}: ${formatCents(pick.savingCents)} less than keeping it, fees included, over ${termMonths} months.`,
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
    keepMonths: keep.months,
    currentTotalCents,
    offers: scored,
    pick,
    runnersUp: pick ? scored.filter((o) => o !== pick).slice(0, REFI_RUNNERS_UP) : [],
    why,
    // Only where there is escrow: a payment that's all principal and interest needs no note.
    ...(debt.principalAndInterestCents &&
    debt.paymentCents &&
    debt.paymentCents > debt.principalAndInterestCents
      ? { escrowCents: debt.paymentCents - debt.principalAndInterestCents }
      : {}),
  };
}
