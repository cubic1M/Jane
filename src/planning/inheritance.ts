import {
  ESTATE_LAWYER_POINTER,
  FEDERAL_ESTATE_FACT,
  GIFT_SPLIT_FACTOR,
  INHERITED_IRA_YEARS,
  SPREAD_MIN_SAVING_CENTS,
  STATE_DEATH_TAXES,
} from "@/config/inheritance";
import { estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";

// Inherited money and gifts (spec step 268). Pure: when an inherited IRA must be empty,
// how to spread it so the tax is lower than taking it all at the end, what the step-up in
// basis means for an inherited asset, which gifts need a gift tax return, and the estate tax
// facts. Facts only; the chat points to counsel.

const round = Math.round;

// The year an inherited IRA must be empty by: the end of the 10th year after the owner died.
export const mustBeEmptyBy = (diedYear: number) => diedYear + INHERITED_IRA_YEARS;

export type Spread = {
  years: number;
  perYearCents: number;
  // Extra federal tax over the years, spread evenly against all at the end.
  spreadTaxCents: number;
  lumpTaxCents: number;
  savesCents: number;
  worthRaising: boolean;
};

// Taking the money out evenly over the years left against all in the last year, using the
// same estimate engine as step 120 and the person's income as it stands.
export function spreadIra(input: {
  balanceCents: number;
  yearsLeft: number;
  base: EstimateInput;
}): Spread {
  const years = Math.max(1, input.yearsLeft);
  const tax = (extra: number) =>
    estimateTaxes({
      ...input.base,
      income: {
        ...input.base.income,
        retirementCents: input.base.income.retirementCents + extra,
      },
    }).totalTaxCents;
  const baseTax = tax(0);
  const perYear = round(input.balanceCents / years);
  const spread = years * (tax(perYear) - baseTax);
  const lump = tax(input.balanceCents) - baseTax;
  const saves = lump - spread;
  return {
    years,
    perYearCents: perYear,
    spreadTaxCents: spread,
    lumpTaxCents: lump,
    savesCents: saves,
    worthRaising: years > 1 && saves >= SPREAD_MIN_SAVING_CENTS,
  };
}

// An inherited asset's basis is its value on the day the owner died, so selling soon after
// has little or no gain to tax.
export function stepUp(input: {
  valueAtDeathCents: number;
  costToOwnerCents: number;
  saleCents: number;
}) {
  const gainWithStepUp = Math.max(0, input.saleCents - input.valueAtDeathCents);
  const gainWithout = Math.max(0, input.saleCents - input.costToOwnerCents);
  return { gainWithStepUp, gainWithout, gainAvoided: gainWithout - gainWithStepUp };
}

export type Gift = { recipient: string; cents: number };

// Gifts to one person in the year over the exclusion need a gift tax return (Form 709), even
// though no tax is usually owed: the excess counts against the lifetime exclusion. A married
// couple can split a gift to double the exclusion, which also takes a Form 709.
export function giftsOverExclusion(
  gifts: readonly Gift[],
  exclusionCents: number,
  jointly: boolean,
): { recipient: string; cents: number; overCents: number; splitCovers: boolean }[] {
  const by = new Map<string, number>();
  for (const g of gifts) by.set(g.recipient, (by.get(g.recipient) ?? 0) + g.cents);
  return [...by.entries()]
    .filter(([, cents]) => cents > exclusionCents)
    .map(([recipient, cents]) => ({
      recipient,
      cents,
      overCents: cents - exclusionCents,
      splitCovers: jointly && cents <= exclusionCents * GIFT_SPLIT_FACTOR,
    }))
    .sort((a, b) => b.cents - a.cents || a.recipient.localeCompare(b.recipient));
}

export function estateFacts(state: string | null): string[] {
  const out = [FEDERAL_ESTATE_FACT];
  if (state && STATE_DEATH_TAXES[state]) out.push(STATE_DEATH_TAXES[state]);
  out.push(ESTATE_LAWYER_POINTER);
  return out;
}
