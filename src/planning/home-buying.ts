import {
  HOME_CLOSING_COSTS_SHARE,
  HOME_INSURANCE_YEARLY_SHARE,
  HOME_MAX_DEBT_SHARE,
  HOME_MAX_HOUSING_SHARE,
  HOME_MAX_PRICE_CENTS,
  HOME_NET_TO_GROSS,
  HOME_PMI_BELOW_DOWN_SHARE,
  HOME_PMI_YEARLY_SHARE,
  HOME_PRICE_STEP_CENTS,
  HOME_PROPERTY_TAX_YEARLY_SHARE,
} from "@/config/home-buying";
import { levelPaymentCents } from "./refinance";

// Buying a home (spec step 179). Pure: the monthly cost of a home at a price and a down
// payment (loan, property tax, insurance, mortgage insurance), the cash needed up front,
// the most the person can afford under the usual 28/36 rules, and how long saving takes.

export type HomeCosts = {
  priceCents: number;
  downCents: number;
  loanCents: number;
  principalAndInterestCents: number;
  propertyTaxCents: number;
  insuranceCents: number;
  pmiCents: number;
  // Everything a month for the home.
  housingCents: number;
  closingCents: number;
  // The down payment and the closing costs: what to have saved.
  cashNeededCents: number;
};

export function homeCosts(input: {
  priceCents: number;
  downShare: number;
  aprBps: number;
  termMonths: number;
}): HomeCosts {
  const downCents = Math.round(input.priceCents * input.downShare);
  const loanCents = input.priceCents - downCents;
  const principalAndInterestCents = levelPaymentCents(loanCents, input.aprBps, input.termMonths);
  const propertyTaxCents = Math.round((input.priceCents * HOME_PROPERTY_TAX_YEARLY_SHARE) / 12);
  const insuranceCents = Math.round((input.priceCents * HOME_INSURANCE_YEARLY_SHARE) / 12);
  const pmiCents =
    input.downShare < HOME_PMI_BELOW_DOWN_SHARE
      ? Math.round((loanCents * HOME_PMI_YEARLY_SHARE) / 12)
      : 0;
  const closingCents = Math.round(input.priceCents * HOME_CLOSING_COSTS_SHARE);
  return {
    priceCents: input.priceCents,
    downCents,
    loanCents,
    principalAndInterestCents,
    propertyTaxCents,
    insuranceCents,
    pmiCents,
    housingCents: principalAndInterestCents + propertyTaxCents + insuranceCents + pmiCents,
    closingCents,
    cashNeededCents: downCents + closingCents,
  };
}

export type Affordability = {
  grossMonthlyCents: number;
  housingLimitCents: number;
  debtLimitCents: number;
  // The housing cost the rules allow: the smaller of the 28% limit and what's left of the
  // 36% limit after the person's other debt payments.
  allowedHousingCents: number;
  maxPriceCents: number;
};

export function affordability(input: {
  monthlyNetIncomeCents: number;
  debtPaymentsCents: number;
  downShare: number;
  aprBps: number;
  termMonths: number;
}): Affordability {
  const grossMonthlyCents = Math.round(input.monthlyNetIncomeCents / HOME_NET_TO_GROSS);
  const housingLimitCents = Math.round(grossMonthlyCents * HOME_MAX_HOUSING_SHARE);
  const debtLimitCents = Math.round(grossMonthlyCents * HOME_MAX_DEBT_SHARE);
  const allowedHousingCents = Math.max(
    0,
    Math.min(housingLimitCents, debtLimitCents - input.debtPaymentsCents),
  );
  let low = 0;
  let high = Math.floor(HOME_MAX_PRICE_CENTS / HOME_PRICE_STEP_CENTS);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const cost = homeCosts({
      priceCents: mid * HOME_PRICE_STEP_CENTS,
      downShare: input.downShare,
      aprBps: input.aprBps,
      termMonths: input.termMonths,
    }).housingCents;
    if (cost <= allowedHousingCents) low = mid;
    else high = mid - 1;
  }
  return {
    grossMonthlyCents,
    housingLimitCents,
    debtLimitCents,
    allowedHousingCents,
    maxPriceCents: low * HOME_PRICE_STEP_CENTS,
  };
}

export type SavingPlan = {
  stillNeededCents: number;
  // At the person's own monthly saving: months to the goal, or null if they save nothing.
  monthsAtCurrentPace: number | null;
  // What it takes a month to have it by the target date.
  monthlyNeededCents: number;
  monthsToTarget: number;
  onTrack: boolean;
};

const monthsBetween = (from: string, to: string) => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
};

export function savingPlan(input: {
  cashNeededCents: number;
  savedCents: number;
  monthlySavingCents: number;
  asOf: string;
  targetDate: string;
}): SavingPlan {
  const stillNeededCents = Math.max(0, input.cashNeededCents - input.savedCents);
  const monthsToTarget = monthsBetween(input.asOf, input.targetDate);
  const monthlyNeededCents = Math.ceil(stillNeededCents / monthsToTarget);
  return {
    stillNeededCents,
    monthsAtCurrentPace:
      stillNeededCents === 0
        ? 0
        : input.monthlySavingCents > 0
          ? Math.ceil(stillNeededCents / input.monthlySavingCents)
          : null,
    monthlyNeededCents,
    monthsToTarget,
    onTrack: stillNeededCents === 0 || input.monthlySavingCents >= monthlyNeededCents,
  };
}
