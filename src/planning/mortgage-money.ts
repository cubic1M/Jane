import {
  INVEST_COMPARE_MAX_YEARS,
  RECAST_FEE_CENTS,
  RECAST_MIN_LUMP_CENTS,
} from "@/config/mortgage-money";
import { RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import { addMonths } from "./home-equity";
import { levelPaymentCents } from "./refinance";

// Recast, refinance or pay extra (spec step 246). Pure: a mortgage, a lump sum and/or extra
// monthly money, and what each way of using it does over the loan's life, with its fees and
// the date it pays back, against investing it instead.

const MAX_MONTHS = 12 * 60;

type Run = { months: number; interestCents: number; cumulative: number[]; paymentCents: number };

// Month by month: interest at the rate, the payment (plus extra) against the balance.
export function run(
  balanceCents: number,
  aprBps: number,
  paymentCents: number,
  extraMonthlyCents = 0,
): Run {
  const r = aprBps / 10_000 / 12;
  let balance = balanceCents;
  let interest = 0;
  const cumulative: number[] = [0];
  let months = 0;
  while (balance > 0 && months < MAX_MONTHS) {
    const i = Math.round(balance * r);
    const pay = Math.min(balance + i, paymentCents + extraMonthlyCents);
    if (pay <= i) break;
    interest += i;
    balance = balance + i - pay;
    months += 1;
    cumulative.push(interest);
  }
  return { months, interestCents: interest, cumulative, paymentCents };
}

const at = (cum: number[], m: number) => cum[Math.min(m, cum.length - 1)];

// The first month the option's interest plus its fee is below the baseline's; null if never.
export function breakEvenMonth(base: Run, option: Run, feeCents: number): number | null {
  // No fee, nothing to pay back.
  if (feeCents <= 0) return null;
  const horizon = Math.max(base.months, option.months);
  for (let m = 1; m <= horizon; m++) {
    if (at(base.cumulative, m) - at(option.cumulative, m) >= feeCents) return m;
  }
  return null;
}

export type MoneyOption = {
  kind: "extra" | "recast" | "refinance";
  label: string;
  available: boolean;
  why: string | null;
  feeCents: number;
  paymentCents: number;
  monthsToPayoff: number;
  endsOn: string;
  totalInterestCents: number;
  // Against doing nothing, fee counted.
  interestSavedCents: number;
  breakEvenMonths: number | null;
  breakEvenOn: string | null;
};

export type InvestOption = {
  putCents: number;
  years: number;
  lowGainCents: number;
  highGainCents: number;
};

export type MortgageMoney = {
  baseline: {
    paymentCents: number;
    monthsToPayoff: number;
    endsOn: string;
    totalInterestCents: number;
  };
  options: MoneyOption[];
  invest: InvestOption;
  // What pays more over the loan's life, in plain terms: certain interest saved against a
  // range of investment gains.
  verdict: "pay_down" | "invest" | "close";
  guaranteedReturnPercent: number;
};

const grow = (lump: number, monthly: number, months: number, annual: number) => {
  const r = Math.pow(1 + annual, 1 / 12) - 1;
  const lumpValue = lump * Math.pow(1 + r, months);
  const monthlyValue = r === 0 ? monthly * months : monthly * ((Math.pow(1 + r, months) - 1) / r);
  return Math.round(lumpValue + monthlyValue);
};

export function compareMortgageMoney(input: {
  balanceCents: number;
  aprBps: number;
  // Months left to the loan's end date.
  monthsLeft: number;
  lumpCents: number;
  extraMonthlyCents: number;
  today: string;
  refi: { lender: string; aprBps: number; feeCents: number } | null;
}): MortgageMoney {
  const { balanceCents, aprBps, monthsLeft, lumpCents, extraMonthlyCents, today } = input;
  const payment = levelPaymentCents(balanceCents, aprBps, monthsLeft);
  const base = run(balanceCents, aprBps, payment);
  const on = (months: number) => addMonths(today, months);
  const afterLump = Math.max(0, balanceCents - lumpCents);
  const options: MoneyOption[] = [];

  const finish = (
    kind: MoneyOption["kind"],
    label: string,
    r: Run,
    feeCents: number,
    available = true,
    why: string | null = null,
  ): MoneyOption => {
    const be = available ? breakEvenMonth(base, r, feeCents) : null;
    return {
      kind,
      label,
      available,
      why,
      feeCents,
      paymentCents: r.paymentCents,
      monthsToPayoff: r.months,
      endsOn: on(r.months),
      totalInterestCents: r.interestCents + feeCents,
      interestSavedCents: base.interestCents - r.interestCents - feeCents,
      breakEvenMonths: be,
      breakEvenOn: be === null ? null : on(be),
    };
  };

  // Extra principal: the lump now and the extra every month, the payment unchanged.
  options.push(
    finish("extra", "Pay extra principal", run(afterLump, aprBps, payment, extraMonthlyCents), 0),
  );

  // A recast re-amortizes what's left over the same end date: the lump pays the balance down
  // and the payment falls; extra monthly money, if any, is still paid on top.
  const recastOk = lumpCents >= RECAST_MIN_LUMP_CENTS && lumpCents < balanceCents;
  const recastPayment = levelPaymentCents(afterLump, aprBps, monthsLeft);
  options.push(
    finish(
      "recast",
      "Recast the mortgage",
      run(afterLump, aprBps, recastPayment, extraMonthlyCents),
      RECAST_FEE_CENTS,
      recastOk,
      recastOk
        ? null
        : lumpCents <= 0
          ? "A recast needs a lump sum."
          : lumpCents >= balanceCents
            ? "That pays the loan off."
            : "Most servicers need a bigger lump sum to recast.",
    ),
  );

  // A refinance of what's left after the lump, at the best rate on offer, over the same months.
  const refi = input.refi;
  const refiOk = refi !== null && refi.aprBps < aprBps && afterLump > 0;
  const refiPayment = refi ? levelPaymentCents(afterLump, refi.aprBps, monthsLeft) : payment;
  options.push(
    finish(
      "refinance",
      refi ? `Refinance with ${refi.lender}` : "Refinance",
      run(afterLump, refi?.aprBps ?? aprBps, refiPayment, extraMonthlyCents),
      refi?.feeCents ?? 0,
      refiOk,
      refiOk ? null : refi ? "No offer is under your rate." : "No refinance offer to compare.",
    ),
  );

  // Investing the same money for the loan's remaining life.
  const years = Math.min(INVEST_COMPARE_MAX_YEARS, Math.max(1, Math.round(monthsLeft / 12)));
  const months = years * 12;
  const put = lumpCents + extraMonthlyCents * months;
  const invest: InvestOption = {
    putCents: put,
    years,
    lowGainCents: grow(lumpCents, extraMonthlyCents, months, RETURN_LOW.value) - put,
    highGainCents: grow(lumpCents, extraMonthlyCents, months, RETURN_HIGH.value) - put,
  };
  const rate = aprBps / 10_000;
  return {
    baseline: {
      paymentCents: payment,
      monthsToPayoff: base.months,
      endsOn: on(base.months),
      totalInterestCents: base.interestCents,
    },
    options,
    invest,
    verdict: rate >= RETURN_HIGH.value ? "pay_down" : rate <= RETURN_LOW.value ? "invest" : "close",
    guaranteedReturnPercent: Math.round(rate * 1000) / 10,
  };
}
