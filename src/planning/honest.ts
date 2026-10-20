// Honest performance (spec step 233). Pure. How the money really did over a period, step by
// step: the investments' own return (prices, with deposits and withdrawals taken out), less
// fees, less the tax on payouts; the return weighted by when the person's money went in and
// out; and a benchmark mix with the same risk. The gap to the benchmark is split into its
// reasons, which add up exactly: fees, cash held, taxes, timing, and what's left (the mix
// itself). Cumulative over the period, as fractions. Only what happened.

export type HonestInput = {
  years: number;
  // The investments' own return over the period (time-weighted, before fees and taxes).
  twr: number;
  // The person's money's return (money-weighted: counts when money went in and out).
  mwr: number | null;
  // The benchmark mix in index funds, over the same period, before its own fees.
  benchmark: number;
  // Weighted yearly cost of what they hold, and of the benchmark funds, in basis points.
  ownFeeBps: number;
  benchFeeBps: number;
  // Shares held in cash, theirs and the benchmark's.
  ownCashShare: number;
  benchCashShare: number;
  // Yearly tax on payouts in taxable accounts as basis points of everything invested.
  taxDragBps: number;
};

export type Reason = {
  key: "fees" | "cash" | "taxes" | "timing" | "mix";
  label: string;
  points: number;
};

export type HonestPeriod = {
  years: number;
  beforeFees: number;
  afterFees: number;
  afterTaxes: number;
  moneyWeighted: number | null;
  benchmark: number;
  // After fees and taxes, less the benchmark (also after its fees).
  gap: number;
  reasons: Reason[];
};

export function honestPeriod(i: HonestInput): HonestPeriod {
  const fee = (i.ownFeeBps / 10_000) * i.years;
  const benchFee = (i.benchFeeBps / 10_000) * i.years;
  const tax = (i.taxDragBps / 10_000) * i.years;
  const afterFees = i.twr - fee;
  const afterTaxes = afterFees - tax;
  const benchmark = i.benchmark - benchFee;
  const gap = afterTaxes - benchmark;
  // Each reason, signed: how many points of the gap it explains.
  const fees = -(fee - benchFee);
  // Cash earns nothing in the model, so holding more of it than the benchmark gives up the
  // benchmark's return on that share.
  const cash = -(i.ownCashShare - i.benchCashShare) * Math.max(0, i.benchmark);
  const taxes = -tax;
  const timing = i.mwr === null ? 0 : i.mwr - i.twr;
  const mix = gap - (fees + cash + taxes + timing);
  return {
    years: i.years,
    beforeFees: i.twr,
    afterFees,
    afterTaxes,
    moneyWeighted: i.mwr,
    benchmark,
    gap,
    reasons: [
      { key: "fees", label: "What the funds cost you", points: fees },
      { key: "cash", label: "Money held in cash", points: cash },
      { key: "taxes", label: "Tax on payouts", points: taxes },
      { key: "timing", label: "When your money went in and out", points: timing },
      { key: "mix", label: "What you hold compared with the benchmark mix", points: mix },
    ],
  };
}

export const annualized = (cumulative: number, years: number) =>
  years > 0 ? (1 + cumulative) ** (1 / years) - 1 : cumulative;
