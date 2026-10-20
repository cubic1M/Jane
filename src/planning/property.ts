import { PAYDOWN_YEARS } from "@/config/property";
import { RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";

// Property as an investment (spec step 214, demo advice). Pure: home equity, a rental's
// profit and return from its own transactions, depreciation for the taxes side, and whether
// paying the mortgage down beats investing.

export const homeEquity = (valueCents: number, loanCents: number) => valueCents - loanCents;

export type RentalFigures = {
  rentCents: number;
  mortgagePaidCents: number;
  mortgageInterestCents: number;
  principalCents: number;
  propertyTaxCents: number;
  otherExpensesCents: number;
  // Rent less everything paid out, including the whole mortgage payment: what hit the bank.
  cashFlowCents: number;
  // Rent less expenses and mortgage interest, before depreciation.
  profitCents: number;
  depreciationCents: number;
  // The profit the taxes side starts from: profit less depreciation.
  taxableCents: number;
  // Cash flow over the cash put in; with principal paid down counted as well.
  cashOnCash: number | null;
  returnWithPrincipal: number | null;
};

export function rentalFigures(input: {
  rentCents: number;
  mortgagePaidCents: number;
  propertyTaxCents: number;
  otherExpensesCents: number;
  // Interest the loan charged in the period, estimated from its balance and rate.
  mortgageInterestCents: number;
  depreciationCents: number;
  cashInvestedCents: number;
}): RentalFigures {
  const principal = Math.max(0, input.mortgagePaidCents - input.mortgageInterestCents);
  const out = input.mortgagePaidCents + input.propertyTaxCents + input.otherExpensesCents;
  const cashFlow = input.rentCents - out;
  const profit =
    input.rentCents -
    input.propertyTaxCents -
    input.otherExpensesCents -
    input.mortgageInterestCents;
  const cash = input.cashInvestedCents;
  return {
    rentCents: input.rentCents,
    mortgagePaidCents: input.mortgagePaidCents,
    mortgageInterestCents: input.mortgageInterestCents,
    principalCents: principal,
    propertyTaxCents: input.propertyTaxCents,
    otherExpensesCents: input.otherExpensesCents,
    cashFlowCents: cashFlow,
    profitCents: profit,
    depreciationCents: input.depreciationCents,
    taxableCents: profit - input.depreciationCents,
    cashOnCash: cash > 0 ? cashFlow / cash : null,
    returnWithPrincipal: cash > 0 ? (cashFlow + principal) / cash : null,
  };
}

// Interest a loan charges over `months`, month by month, with level payments.
export function interestOver(
  balanceCents: number,
  rateBps: number,
  paymentCents: number,
  months: number,
) {
  let balance = balanceCents;
  let interest = 0;
  for (let i = 0; i < months && balance > 0; i += 1) {
    const monthly = Math.round((balance * rateBps) / 10_000 / 12);
    interest += monthly;
    balance = Math.max(0, balance - Math.max(0, paymentCents - monthly));
  }
  return { interestCents: interest, balanceCents: balance };
}

export type Paydown = {
  extraMonthlyCents: number;
  years: number;
  // Paying the mortgage down: the interest saved over the years, a certain amount.
  paydown: { interestSavedCents: number };
  // Investing the same money instead: what it could be worth, as a range, less the same
  // money put in, so the two sides are in the same terms (the gain).
  invest: { lowGainCents: number; highGainCents: number };
  verdict: "paydown" | "invest" | "close";
};

const grow = (monthly: number, years: number, annual: number) => {
  const r = Math.pow(1 + annual, 1 / 12) - 1;
  const n = years * 12;
  return Math.round(monthly * ((Math.pow(1 + r, n) - 1) / r));
};

export function paydownVsInvest(input: {
  balanceCents: number;
  rateBps: number;
  paymentCents: number;
  extraMonthlyCents: number;
  years?: number;
}): Paydown {
  const years = input.years ?? PAYDOWN_YEARS;
  const base = interestOver(input.balanceCents, input.rateBps, input.paymentCents, years * 12);
  const extra = interestOver(
    input.balanceCents,
    input.rateBps,
    input.paymentCents + input.extraMonthlyCents,
    years * 12,
  );
  const put = input.extraMonthlyCents * years * 12;
  const rate = input.rateBps / 10_000;
  return {
    extraMonthlyCents: input.extraMonthlyCents,
    years,
    paydown: { interestSavedCents: base.interestCents - extra.interestCents },
    invest: {
      lowGainCents: grow(input.extraMonthlyCents, years, RETURN_LOW.value) - put,
      highGainCents: grow(input.extraMonthlyCents, years, RETURN_HIGH.value) - put,
    },
    verdict: rate >= RETURN_HIGH.value ? "paydown" : rate <= RETURN_LOW.value ? "invest" : "close",
  };
}
