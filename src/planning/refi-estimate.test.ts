import { describe, expect, it } from "vitest";
import { BENCHMARK_MAX_AGE_DAYS, BENCHMARK_SNAPSHOT } from "@/config/benchmarks";
import { REFI_CARD_TERM_MONTHS, REFI_ESTIMATE, REFI_MIN_SAVING_CENTS } from "@/config/debt";
import type { Debt } from "@/insights/debts";
import {
  estimateForDebt,
  estimateRefinance,
  freshBenchmark,
  type RefiEstimateInput,
} from "./refi-estimate";
import { levelPaymentCents } from "./refinance";

const TODAY = "2026-11-06";

const shown = (input: RefiEstimateInput, today = TODAY) => {
  const estimate = estimateRefinance(input, today);
  if (!estimate.show) throw new Error(`expected an estimate, got ${estimate.reason}`);
  return estimate;
};
const reason = (input: RefiEstimateInput, today = TODAY) => {
  const estimate = estimateRefinance(input, today);
  return estimate.show ? "shown" : estimate.reason;
};

const auto: RefiEstimateInput = {
  product: "auto",
  balanceCents: 2_000_000,
  aprBps: 1_100,
  remainingMonths: 48,
};
const card: RefiEstimateInput = {
  product: "card",
  balanceCents: 800_000,
  aprBps: 2_499,
  remainingMonths: null,
};
const mortgage: RefiEstimateInput = {
  product: "mortgage",
  balanceCents: 30_000_000,
  aprBps: 950,
  remainingMonths: 300,
  rateType: "fixed",
  prepaymentPenalty: false,
};

describe("the benchmark snapshot", () => {
  it("names each series under its own key, with a date and FRED as the source", () => {
    for (const [series, benchmark] of Object.entries(BENCHMARK_SNAPSHOT)) {
      if (!benchmark) continue;
      expect(benchmark.series).toBe(series);
      expect(Number.isInteger(benchmark.rateBps) && benchmark.rateBps > 0).toBe(true);
      expect(benchmark.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(benchmark.source).toBe(`https://fred.stlouisfed.org/series/${series}`);
    }
  });

  it("goes stale after its limit, and is never read before its own date", () => {
    const weekly = BENCHMARK_SNAPSHOT.MORTGAGE30US!;
    const day = (offset: number) =>
      new Date(Date.parse(weekly.asOf) + offset * 86_400_000).toISOString().slice(0, 10);
    expect(freshBenchmark("MORTGAGE30US", day(BENCHMARK_MAX_AGE_DAYS.weekly))).toBe(weekly);
    expect(freshBenchmark("MORTGAGE30US", day(BENCHMARK_MAX_AGE_DAYS.weekly + 1))).toBeNull();
    expect(freshBenchmark("MORTGAGE30US", day(-1))).toBeNull();
    expect(freshBenchmark("MORTGAGE15US", TODAY)).toBeNull();
  });
});

describe("estimateRefinance", () => {
  it("measures an auto loan against the average bank rate, at its own remaining months", () => {
    const estimate = shown(auto);
    expect(estimate.newAprBps).toBe(BENCHMARK_SNAPSHOT.RIFLPBCIANM60NM!.rateBps);
    expect(estimate.termMonths).toBe(48);
    expect(estimate.keepMonthlyCents).toBe(levelPaymentCents(2_000_000, 1_100, 48));
    expect(estimate.newMonthlyCents).toBe(levelPaymentCents(2_000_000, 754, 48));
    expect(estimate.savingCents.low).toBeGreaterThanOrEqual(REFI_MIN_SAVING_CENTS);
    expect(estimate.upfrontCents).toEqual({ low: 0, high: 0 });
    expect(estimate.breakEvenMonths).toBeNull();
    expect(estimate.confidence.percent).toBe(60);
    expect(estimate.lines[0]).toContain("not a lender's quote");
    expect(estimate.lines.join(" ")).toContain("title fees");
  });

  it("never calls a longer term a saving: both sides run the same months", () => {
    const short = shown({ ...auto, remainingMonths: 30 });
    expect(short.termMonths).toBe(30);
    // Stretching it to 72 months would lower the payment much more; it isn't done.
    expect(short.newMonthlyCents).toBeGreaterThan(levelPaymentCents(2_000_000, 754, 72));
  });

  it("puts the APR next to every payment it shows", () => {
    for (const input of [auto, card, mortgage]) {
      const [rate, payment] = shown(input).lines;
      expect(rate).toMatch(/\d+\.\d{2}% APR instead of your \d+\.\d{2}% APR/);
      expect(payment).toMatch(/a month/);
    }
  });

  it("keeps quiet on a small, short or nearly-average auto loan", () => {
    expect(reason({ ...auto, balanceCents: REFI_ESTIMATE.auto.minBalanceCents - 1 })).toBe(
      "too_small",
    );
    expect(reason({ ...auto, remainingMonths: REFI_ESTIMATE.auto.minRemainingMonths - 1 })).toBe(
      "too_short",
    );
    expect(reason({ ...auto, aprBps: 754 + REFI_ESTIMATE.auto.minGapBps - 1 })).toBe(
      "rate_close_to_average",
    );
  });

  it("says nothing without a rate or balance", () => {
    expect(reason({ ...auto, balanceCents: null })).toBe("missing_rate_or_balance");
    expect(reason({ ...auto, balanceCents: 0 })).toBe("missing_rate_or_balance");
    expect(reason({ ...auto, aprBps: null })).toBe("missing_rate_or_balance");
    expect(reason({ ...auto, remainingMonths: null })).toBe("missing_rate_or_balance");
  });

  it("says nothing on a stale average", () => {
    // Monthly data: four months from the observation's date.
    expect(reason(auto, "2026-11-29")).toBe("shown");
    expect(reason(auto, "2026-12-15")).toBe("stale_benchmark");
    expect(reason(mortgage, "2026-11-25")).toBe("stale_benchmark");
  });

  it("moves a card's balance to a personal loan over the card term, with its fee borrowed", () => {
    const estimate = shown(card);
    expect(estimate.termMonths).toBe(REFI_CARD_TERM_MONTHS);
    const borrowed = Math.ceil(800_000 / (1 - REFI_ESTIMATE.card.feeShare));
    expect(estimate.upfrontCents).toEqual({ low: borrowed - 800_000, high: borrowed - 800_000 });
    expect(estimate.newMonthlyCents).toBe(
      levelPaymentCents(borrowed, 1_190, REFI_CARD_TERM_MONTHS),
    );
    expect(estimate.lines[2]).toContain("loan fee is counted");
    // A card has no early-payoff charge to wonder about.
    expect(estimate.lines).toHaveLength(3);
    expect(reason({ ...card, balanceCents: 150_000 })).toBe("too_small");
    expect(reason({ ...card, aprBps: 1_500 })).toBe("rate_close_to_average");
  });

  it("gives a mortgage closing costs as a range and when they're paid back", () => {
    const estimate = shown(mortgage);
    const average = BENCHMARK_SNAPSHOT.MORTGAGE30US!.rateBps;
    expect(estimate.newAprBps).toBe(average + REFI_ESTIMATE.mortgage.cushionBps);
    expect(estimate.upfrontCents).toEqual({ low: 900_000, high: 1_800_000 });
    const drop = estimate.keepMonthlyCents - estimate.newMonthlyCents;
    expect(estimate.breakEvenMonths).toEqual({
      low: Math.ceil(900_000 / drop),
      high: Math.ceil(1_800_000 / drop),
    });
    expect(estimate.breakEvenMonths!.low).toBeLessThanOrEqual(36);
    // The worse case pays the higher closing costs.
    expect(estimate.savingCents.high - estimate.savingCents.low).toBe(900_000);
    expect(estimate.lines[0]).toContain("plus a margin");
    expect(estimate.lines[2]).toMatch(/Closing costs of about \$9,000\.00 to \$18,000\.00/);
    expect(estimate.prepayment).toBe("none");
  });

  it("keeps quiet when a mortgage's costs come back too late, or after the person moves", () => {
    // 8.5%: a drop just over the minimum, but $9,000 takes over three years to come back.
    expect(reason({ ...mortgage, aprBps: 850 })).toBe("pays_back_too_late");
    expect(reason({ ...mortgage, expectedStayMonths: 12 })).toBe("pays_back_too_late");
    expect(reason({ ...mortgage, aprBps: 718 + REFI_ESTIMATE.mortgage.cushionBps + 74 })).toBe(
      "rate_close_to_average",
    );
  });

  it("sends a variable rate or a known penalty elsewhere, and says an unknown one is unknown", () => {
    expect(reason({ ...mortgage, rateType: "variable" })).toBe("variable_rate");
    expect(reason({ ...mortgage, prepaymentPenalty: true })).toBe("check_your_note");
    const unknown = shown({ ...mortgage, prepaymentPenalty: null });
    expect(unknown.prepayment).toBe("unknown");
    expect(unknown.lines.at(-1)).toContain("paying it off early is unknown");
    expect(shown({ ...auto }).prepayment).toBe("unknown");
  });

  it("has no estimate for 15 years or less left until the 15-year average is looked up", () => {
    expect(reason({ ...mortgage, remainingMonths: REFI_ESTIMATE.mortgage.shortTermMonths })).toBe(
      "no_benchmark",
    );
  });
});

describe("estimateForDebt", () => {
  const debt = (over: Partial<Debt> & Pick<Debt, "kind">): Debt => ({
    key: `account:${over.kind}`,
    accountId: null,
    name: over.kind,
    kindLabel: over.kind,
    balanceCents: 2_000_000,
    balanceFrom: "bank",
    aprBps: 1_100,
    rateType: "fixed",
    aprFrom: "bank",
    paymentCents: null,
    paymentEvery: "month",
    paymentFrom: null,
    nextDue: null,
    dueSoon: false,
    payoffDate: "2030-11-01",
    payoffFrom: "bank",
    overdue: false,
    pastDueCents: null,
    description: null,
    inNetWorth: true,
    typedOn: null,
    ...over,
  });

  it("estimates an auto loan to its payoff date, and a card over the card term", () => {
    const estimate = estimateForDebt(debt({ kind: "auto" }), TODAY);
    expect(estimate).toMatchObject({ show: true, termMonths: 48 });
    expect(estimateForDebt(debt({ kind: "card", aprBps: 2_499 }), TODAY)).toMatchObject({
      show: true,
      termMonths: REFI_CARD_TERM_MONTHS,
    });
  });

  it("has nothing to measure a student loan or another loan against", () => {
    expect(estimateForDebt(debt({ kind: "student" }), TODAY)).toBeNull();
    expect(estimateForDebt(debt({ kind: "loan" }), TODAY)).toBeNull();
    expect(estimateForDebt(debt({ kind: "bnpl" }), TODAY)).toBeNull();
  });
});
