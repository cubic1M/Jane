import {
  BENCHMARK_MAX_AGE_DAYS,
  BENCHMARK_SNAPSHOT,
  type Benchmark,
  type BenchmarkSeries,
} from "@/config/benchmarks";
import {
  REFI_CARD_TERM_MONTHS,
  REFI_ESTIMATE,
  REFI_ESTIMATE_CONFIDENCE,
  REFI_MIN_SAVING_CENTS,
} from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/percent";
import { levelPaymentCents, remainingMonths, totalPaidCents } from "./refinance";

// A refinance estimate with no lender's offer (connectors roadmap round 15, loans section 8): the
// person's own rate and balance against a public average (src/config/benchmarks.ts), at the
// loan's own remaining months on both sides, so a lower payment from a longer term is never
// called a saving. Mortgages count closing costs as a 3%-6% range and say when they're paid
// back; a card's balance moves to a personal loan with its fee borrowed too. Nothing here is an
// offer: a card that shows it says so, with the APR next to every payment (Reg Z). Pure.

type Product = keyof typeof REFI_ESTIMATE;

export type RefiEstimateInput = {
  product: Product;
  balanceCents: number | null;
  aprBps: number | null;
  remainingMonths: number | null;
  rateType?: string | null;
  // Plaid's has_prepayment_penalty: null when the lender doesn't say.
  prepaymentPenalty?: boolean | null;
  // How long the person expects to keep the home, if they've said.
  expectedStayMonths?: number | null;
};

type NoEstimate =
  | "missing_rate_or_balance"
  | "no_benchmark"
  | "stale_benchmark"
  | "variable_rate"
  | "check_your_note"
  | "too_small"
  | "too_short"
  | "rate_close_to_average"
  | "saves_too_little"
  | "pays_back_too_late";

type Range = { low: number; high: number };

export type RefiEstimate =
  | { show: false; reason: NoEstimate }
  | {
      show: true;
      product: Product;
      benchmark: Benchmark;
      newAprBps: number;
      termMonths: number;
      keepMonthlyCents: number;
      newMonthlyCents: number;
      // Fees and closing costs; the same low and high for a single figure.
      upfrontCents: Range;
      // Over the same months, upfront costs counted: low is the worse case.
      savingCents: Range;
      // Months for the lower payment to pay the upfront costs back; null with nothing upfront.
      breakEvenMonths: Range | null;
      prepayment: "none" | "unknown";
      confidence: { percent: number; reason: string };
      lines: string[];
    };

const DAY = 86_400_000;

// The average, if it's been looked up and isn't past its age limit on `today` (YYYY-MM-DD).
export function freshBenchmark(series: BenchmarkSeries, today: string): Benchmark | null {
  const benchmark = BENCHMARK_SNAPSHOT[series];
  if (!benchmark) return null;
  const age = (Date.parse(today) - Date.parse(benchmark.asOf)) / DAY;
  return age >= 0 && age <= BENCHMARK_MAX_AGE_DAYS[benchmark.frequency] ? benchmark : null;
}

const range = (low: number, high: number): Range => ({ low, high });
const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
const money = ({ low, high }: Range) =>
  low === high ? formatCents(low) : `${formatCents(low)} to ${formatCents(high)}`;
const span = ({ low, high }: Range) => (low === high ? months(low) : `${low} to ${months(high)}`);

function benchmarkFor(input: RefiEstimateInput, today: string): Benchmark | NoEstimate {
  const series: BenchmarkSeries =
    input.product === "mortgage"
      ? input.remainingMonths! > REFI_ESTIMATE.mortgage.shortTermMonths
        ? REFI_ESTIMATE.mortgage.long
        : REFI_ESTIMATE.mortgage.short
      : REFI_ESTIMATE[input.product].series;
  if (!BENCHMARK_SNAPSHOT[series]) return "no_benchmark";
  return freshBenchmark(series, today) ?? "stale_benchmark";
}

export function estimateRefinance(input: RefiEstimateInput, today: string): RefiEstimate {
  const { product, balanceCents, aprBps } = input;
  const n = product === "card" ? REFI_CARD_TERM_MONTHS : input.remainingMonths;
  if (!balanceCents || balanceCents <= 0 || aprBps === null || !n || n <= 0) {
    return { show: false, reason: "missing_rate_or_balance" };
  }
  // A variable-rate mortgage gets a "your rate can reset" card instead; a penalty of unknown
  // size makes any saving unknowable, so the card says to check the note.
  if (product === "mortgage" && input.rateType === "variable") {
    return { show: false, reason: "variable_rate" };
  }
  if (product === "mortgage" && input.prepaymentPenalty === true) {
    return { show: false, reason: "check_your_note" };
  }
  const benchmark = benchmarkFor({ ...input, remainingMonths: n }, today);
  if (typeof benchmark === "string") return { show: false, reason: benchmark };

  let newAprBps = benchmark.rateBps;
  let upfrontCents = range(0, 0);
  let borrowedCents = balanceCents;
  if (product === "auto") {
    const rule = REFI_ESTIMATE.auto;
    if (balanceCents < rule.minBalanceCents) return { show: false, reason: "too_small" };
    if (n < rule.minRemainingMonths) return { show: false, reason: "too_short" };
    if (aprBps - newAprBps < rule.minGapBps)
      return { show: false, reason: "rate_close_to_average" };
  } else if (product === "card") {
    const rule = REFI_ESTIMATE.card;
    if (balanceCents < rule.minBalanceCents) return { show: false, reason: "too_small" };
    if (aprBps - newAprBps < rule.minGapBps)
      return { show: false, reason: "rate_close_to_average" };
    // The fee comes out of the loan, so enough is borrowed to clear the whole balance.
    borrowedCents = Math.ceil(balanceCents / (1 - rule.feeShare));
    upfrontCents = range(borrowedCents - balanceCents, borrowedCents - balanceCents);
  } else {
    const rule = REFI_ESTIMATE.mortgage;
    newAprBps += rule.cushionBps;
    if (aprBps - newAprBps < rule.minDropBps)
      return { show: false, reason: "rate_close_to_average" };
    upfrontCents = range(
      Math.round(balanceCents * rule.closingCostShare.low),
      Math.round(balanceCents * rule.closingCostShare.high),
    );
  }

  const keepMonthlyCents = levelPaymentCents(balanceCents, aprBps, n);
  const newMonthlyCents = levelPaymentCents(borrowedCents, newAprBps, n);
  const keepTotal = totalPaidCents(balanceCents, aprBps, n);
  // A card's fee is already inside what's repaid; closing costs are paid on top.
  const newTotal = totalPaidCents(borrowedCents, newAprBps, n);
  const extra = product === "mortgage" ? upfrontCents : range(0, 0);
  const savingCents = range(keepTotal - newTotal - extra.high, keepTotal - newTotal - extra.low);
  if (savingCents.high < REFI_MIN_SAVING_CENTS) return { show: false, reason: "saves_too_little" };

  const drop = keepMonthlyCents - newMonthlyCents;
  let breakEvenMonths: Range | null = null;
  if (product === "mortgage") {
    if (drop <= 0) return { show: false, reason: "saves_too_little" };
    breakEvenMonths = range(
      Math.ceil(upfrontCents.low / drop),
      Math.ceil(upfrontCents.high / drop),
    );
    const limit = Math.min(
      REFI_ESTIMATE.mortgage.maxBreakEvenMonths,
      n,
      input.expectedStayMonths ?? Number.POSITIVE_INFINITY,
    );
    if (breakEvenMonths.low > limit) return { show: false, reason: "pays_back_too_late" };
  }

  const prepayment = input.prepaymentPenalty === false ? "none" : "unknown";
  const lines = [
    `About ${formatRate(newAprBps)} APR instead of your ${formatRate(aprBps)} APR, from ${benchmark.name} on ${benchmark.asOf}${product === "mortgage" ? " plus a margin" : ""}. An estimate, not a lender's quote.`,
    `Over the same ${months(n)}: ${formatCents(newMonthlyCents)} a month instead of ${formatCents(keepMonthlyCents)}, about ${money(savingCents)} less in all${product === "mortgage" ? " after closing costs" : ""}.`,
    product === "card"
      ? `A ${formatCents(upfrontCents.low)} loan fee is counted: it's borrowed with the balance.`
      : product === "mortgage"
        ? `Closing costs of about ${money(upfrontCents)} are paid back by the lower payment in ${span(breakEvenMonths!)}.`
        : "Plus any title fees your state charges.",
  ];
  if (prepayment === "unknown" && product !== "card") {
    lines.push(
      "Whether your loan charges for paying it off early is unknown: check with your lender.",
    );
  }
  return {
    show: true,
    product,
    benchmark,
    newAprBps,
    termMonths: n,
    keepMonthlyCents,
    newMonthlyCents,
    upfrontCents,
    savingCents,
    breakEvenMonths,
    prepayment,
    confidence: { ...REFI_ESTIMATE_CONFIDENCE },
    lines,
  };
}

const PRODUCT_FOR_KIND: Partial<Record<Debt["kind"], Product>> = {
  auto: "auto",
  mortgage: "mortgage",
  card: "card",
};

// The same, for one of the person's debts, over its own remaining months. Null for a kind with no
// public average to measure against (student loans, other loans, pay-in-4).
export function estimateForDebt(
  debt: Debt,
  today: string,
  facts: Pick<RefiEstimateInput, "prepaymentPenalty" | "expectedStayMonths"> = {},
): RefiEstimate | null {
  const product = PRODUCT_FOR_KIND[debt.kind];
  if (!product) return null;
  return estimateRefinance(
    {
      product,
      balanceCents: debt.balanceCents,
      aprBps: debt.aprBps,
      remainingMonths: remainingMonths(debt, today),
      rateType: debt.rateType,
      ...facts,
    },
    today,
  );
}
