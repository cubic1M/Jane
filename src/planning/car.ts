import {
  CAR_COST_MAX_SHARE,
  CAR_INSURANCE_DEFAULT_YEARLY_SHARE,
  CAR_INSURANCE_ELASTICITY,
  CAR_MAINTENANCE_YEARLY_SHARE,
  CAR_MAX_PRICE_CENTS,
  CAR_PRICE_STEP_CENTS,
  CAR_REGISTRATION_YEARLY_SHARE,
} from "@/config/car";
import type { LoanOffer } from "@/lib/lenders/partner";
import { levelPaymentCents, totalPaidCents } from "./refinance";

// Buying a car (spec step 178). Pure: the all-in monthly cost of a car at a price, the
// most the person can afford, loan offers compared by total cost, and a dealer's financing
// checked against the best offer.

export const insuranceYearlyCents = (
  priceCents: number,
  current: { yearlyCents: number; carValueCents: number } | null,
): number =>
  current
    ? Math.round(
        current.yearlyCents * (priceCents / current.carValueCents) ** CAR_INSURANCE_ELASTICITY,
      )
    : Math.round(priceCents * CAR_INSURANCE_DEFAULT_YEARLY_SHARE);

export type CarCosts = {
  priceCents: number;
  downCents: number;
  financedCents: number;
  paymentCents: number;
  insuranceCents: number;
  fuelCents: number;
  maintenanceCents: number;
  registrationCents: number;
  // Everything a month, and what the loan costs in all.
  allInCents: number;
  loanTotalCents: number;
};

export function carCosts(input: {
  priceCents: number;
  downCents: number;
  termMonths: number;
  aprBps: number;
  insuranceYearlyCents: number;
  fuelMonthlyCents: number;
}): CarCosts {
  const financedCents = Math.max(0, input.priceCents - input.downCents);
  const paymentCents = levelPaymentCents(financedCents, input.aprBps, input.termMonths);
  const insuranceCents = Math.round(input.insuranceYearlyCents / 12);
  const maintenanceCents = Math.round((input.priceCents * CAR_MAINTENANCE_YEARLY_SHARE) / 12);
  const registrationCents = Math.round((input.priceCents * CAR_REGISTRATION_YEARLY_SHARE) / 12);
  return {
    priceCents: input.priceCents,
    downCents: input.downCents,
    financedCents,
    paymentCents,
    insuranceCents,
    fuelCents: input.fuelMonthlyCents,
    maintenanceCents,
    registrationCents,
    allInCents:
      paymentCents + insuranceCents + input.fuelMonthlyCents + maintenanceCents + registrationCents,
    loanTotalCents:
      financedCents > 0 ? totalPaidCents(financedCents, input.aprBps, input.termMonths) : 0,
  };
}

// The highest price (to CAR_PRICE_STEP_CENTS) whose all-in cost stays within the share of
// monthly income, with a down payment of `downShare` of the price.
export function maxAffordablePrice(input: {
  monthlyIncomeCents: number;
  downShare: number;
  termMonths: number;
  aprBps: number;
  insuranceYearlyFor: (priceCents: number) => number;
  fuelMonthlyCents: number;
}): number {
  const allowance = input.monthlyIncomeCents * CAR_COST_MAX_SHARE;
  const costAt = (price: number) =>
    carCosts({
      priceCents: price,
      downCents: Math.round(price * input.downShare),
      termMonths: input.termMonths,
      aprBps: input.aprBps,
      insuranceYearlyCents: input.insuranceYearlyFor(price),
      fuelMonthlyCents: input.fuelMonthlyCents,
    }).allInCents;
  let low = 0;
  let high = Math.floor(CAR_MAX_PRICE_CENTS / CAR_PRICE_STEP_CENTS);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (costAt(mid * CAR_PRICE_STEP_CENTS) <= allowance) low = mid;
    else high = mid - 1;
  }
  return low * CAR_PRICE_STEP_CENTS;
}

export type ScoredCarOffer = {
  offer: LoanOffer;
  monthlyCents: number;
  // The loan's interest plus its fee over the term.
  totalCents: number;
};

// Offers for the same loan compared by what they cost in all, fees in. Cheapest first.
export function compareCarOffers(
  offers: readonly LoanOffer[],
  financedCents: number,
  termMonths: number,
): ScoredCarOffer[] {
  return offers
    .filter((o) => o.termMonths === termMonths)
    .map((offer) => ({
      offer,
      monthlyCents: levelPaymentCents(financedCents, offer.aprBps, termMonths),
      totalCents: totalPaidCents(financedCents, offer.aprBps, termMonths) + offer.feeCents,
    }))
    .sort((a, b) => a.totalCents - b.totalCents || a.offer.id.localeCompare(b.offer.id));
}

export type DealerCheck = {
  totalCents: number;
  monthlyCents: number;
  // More than the best preapproval costs in all (negative: less).
  extraCents: number;
  extraBps: number;
  verdict: "worse" | "similar" | "better";
};

export function dealerCheck(
  dealer: { aprBps: number; termMonths: number; feesCents: number },
  financedCents: number,
  best: ScoredCarOffer,
  flagBps: number,
): DealerCheck {
  const totalCents =
    totalPaidCents(financedCents, dealer.aprBps, dealer.termMonths) + dealer.feesCents;
  const monthlyCents = levelPaymentCents(financedCents, dealer.aprBps, dealer.termMonths);
  const extraCents = totalCents - best.totalCents;
  const extraBps = dealer.aprBps - best.offer.aprBps;
  return {
    totalCents,
    monthlyCents,
    extraCents,
    extraBps,
    verdict: extraCents <= 0 ? "better" : extraBps > flagBps ? "worse" : "similar",
  };
}
