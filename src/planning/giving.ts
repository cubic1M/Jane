import { GIVING } from "@/config/giving";
import { estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";

// Giving, done smart (spec step 168). Pure. Each option is shown as the tax with it and
// without it, from the same estimate engine as the rest of taxes (federal tax; a year's
// income held the same for the next):
// - bunching: two years of gifts in one year, itemized, then none the next (standard
//   deduction), against giving the same each year;
// - a donor-advised fund: the same bunching, while the fund still grants to charities each
//   year;
// - shares instead of cash: giving long-held shares that have gone up, so their gain is
//   never taxed, against selling them and giving the cash.

export type GivingOption = {
  key: "bunch" | "fund" | "shares";
  title: string;
  why: string;
  // Federal tax over the years compared, with and without the option.
  withCents: number;
  withoutCents: number;
  savesCents: number;
};

export type AppreciatedHolding = {
  name: string;
  valueCents: number;
  // Long-term gain (held over a year).
  longTermGainCents: number;
};

export type GivingInput = {
  input: EstimateInput;
  // A year's giving: what's been given so far this year, projected.
  yearlyCents: number;
  shares: AppreciatedHolding[];
};

const tax = (input: EstimateInput, charityCents: number, extraLongTermCents = 0) =>
  estimateTaxes({
    ...input,
    charityCents,
    income: {
      ...input.income,
      longTermGainsCents: input.income.longTermGainsCents + extraLongTermCents,
    },
  }).totalTaxCents;

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function givingOptions(g: GivingInput): GivingOption[] {
  const gift = g.yearlyCents;
  if (gift < GIVING.minYearlyCents) return [];
  const years = GIVING.bunchYears;
  const out: GivingOption[] = [];

  const each = tax(g.input, gift) * years;
  const bunched = tax(g.input, gift * years) + (years - 1) * tax(g.input, 0);
  out.push({
    key: "bunch",
    title: `Give ${years} years' worth this year, then skip a year`,
    why: `Gifts only lower your tax once your deductions pass the standard deduction. Giving ${dollars(gift * years)} this year and none next year can clear it in the year you give, where ${dollars(gift)} a year may not.`,
    withCents: bunched,
    withoutCents: each,
    savesCents: each - bunched,
  });
  out.push({
    key: "fund",
    title: "Bunch through a donor-advised fund",
    why: `Put ${dollars(gift * years)} into a donor-advised fund this year and take the deduction now; the fund still sends your charities ${dollars(gift)} a year.`,
    withCents: bunched,
    withoutCents: each,
    savesCents: each - bunched,
  });

  // The holding with the most long-term gain for each dollar given.
  const best = g.shares
    .filter((s) => s.longTermGainCents > 0 && s.valueCents > 0)
    .sort((a, b) => b.longTermGainCents / b.valueCents - a.longTermGainCents / a.valueCents)[0];
  if (best) {
    const given = Math.min(gift, best.valueCents);
    const gain = Math.round((best.longTermGainCents * given) / best.valueCents);
    const sell = tax(g.input, gift, gain);
    const give = tax(g.input, gift);
    out.push({
      key: "shares",
      title: `Give ${dollars(given)} of ${best.name} shares instead of cash`,
      why: `They've gone up ${dollars(gain)} on that amount. Given to a charity after more than a year, the gain is never taxed and the gift counts at its full value; sold first, the gain is taxed.`,
      withCents: give,
      withoutCents: sell,
      savesCents: sell - give,
    });
  }
  return out;
}

// Gifts that need a written receipt from the charity.
export const needsReceipt = (cents: number) => cents >= GIVING.receiptFromCents;
