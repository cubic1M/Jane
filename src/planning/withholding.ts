import { WITHHOLDING } from "@/config/tax";

// The withholding checkup (spec step 121): is what comes out of each paycheck about right
// for the tax Jane estimates? Too much is a big refund (money the person could have had all
// year); too little is a bill. Pure. The suggestion is a W-4 change that aims for a small
// refund (WITHHOLDING.targetRefundCents):
// - a bill: Step 4(c), extra withholding per paycheck;
// - a big refund: Step 4(b), deductions, a yearly amount the employer spreads over the
//   paychecks at the person's top rate.
// It's worked out twice: for the paychecks left this year, and from January for a full
// year. Demo advice: shown only in demo advice mode (src/lib/advice-mode.ts).

export type W4Step = "4b" | "4c";

export type W4Change = {
  step: W4Step;
  // 4(c): extra withholding per paycheck. 4(b): yearly deductions.
  amountCents: number;
  // What it does to each paycheck's withholding (negative: less withheld).
  perPaycheckCents: number;
  // The estimated refund (negative: owed) after the change.
  refundAfterCents: number;
};

export type WithholdingCheck =
  // no_rate: a big refund at a 0% top rate (credits, not tax, make it): a Step 4(b) deduction
  // takes nothing off the withholding, so it can't be sized.
  | { status: "unknown"; why: "no_pay" | "no_withholding" | "no_rate" }
  | { status: "on_track"; refundCents: number }
  | {
      status: "big_refund" | "bill_coming";
      refundCents: number;
      lastYearRefundCents: number | null;
      targetCents: number;
      paychecksLeft: number;
      perYear: number;
      // Null when there are no paychecks left this year.
      thisYear: W4Change | null;
      fromJanuary: W4Change;
    };

const floorTo = (cents: number, step: number) => Math.floor(cents / step) * step;
const ceilTo = (cents: number, step: number) => Math.ceil(cents / step) * step;

// What a W-4 change does to the withholding on each paycheck.
export function perPaycheckEffect(
  step: W4Step,
  amountCents: number,
  marginalRate: number,
  perYear: number,
): number {
  return step === "4c" ? amountCents : -Math.round((amountCents * marginalRate) / perYear);
}

// The top rate Step 4(b) is sized and predicted with: one rate for both, never two.
const step4bRate = (marginalRate: number) => Math.max(marginalRate, 0.1);

function change(
  gapCents: number,
  paychecks: number,
  perYear: number,
  marginalRate: number,
  refundCents: number,
): W4Change {
  // gap > 0: withhold more (a bill); gap < 0: withhold less (a big refund).
  if (gapCents > 0) {
    const amount = ceilTo(gapCents / paychecks, WITHHOLDING.roundExtraCents);
    return {
      step: "4c",
      amountCents: amount,
      perPaycheckCents: amount,
      refundAfterCents: refundCents + amount * paychecks,
    };
  }
  const reduction = -gapCents;
  const rate = step4bRate(marginalRate);
  const amount = floorTo(
    (reduction * perYear) / (paychecks * rate),
    WITHHOLDING.roundDeductionCents,
  );
  const perPaycheck = perPaycheckEffect("4b", amount, rate, perYear);
  return {
    step: "4b",
    amountCents: amount,
    perPaycheckCents: perPaycheck,
    refundAfterCents: refundCents + perPaycheck * paychecks,
  };
}

export function withholdingCheck(input: {
  // From the estimate (src/lib/tax-estimate.ts).
  refundCents: number;
  withholdingKnown: boolean;
  marginalRate: number;
  // Paychecks a year, and how many are left this year.
  perYear: number | null;
  paychecksLeft: number;
  // Federal tax withheld so far, to check a smaller-withholding change leaves some.
  withheldPerPaycheckCents: number;
  // A federal refund seen in the person's accounts for last year, if any (step 125).
  lastYearRefundCents: number | null;
  // The year's wages: a Step 4(b) amount above them isn't a believable W-4 (taxes QA).
  wagesCents?: number;
}): WithholdingCheck {
  if (!input.perYear) return { status: "unknown", why: "no_pay" };
  if (!input.withholdingKnown) return { status: "unknown", why: "no_withholding" };
  const { refundCents, perYear } = input;
  const target = WITHHOLDING.targetRefundCents;
  const big =
    refundCents > WITHHOLDING.bigRefundCents ||
    (refundCents > target && (input.lastYearRefundCents ?? 0) > WITHHOLDING.bigRefundCents);
  const bill = refundCents < -WITHHOLDING.billCents;
  if (!big && !bill) return { status: "on_track", refundCents };

  // Never ask for less withheld than a paycheck has, this year or from January.
  const limited = (c: W4Change, paychecks: number): W4Change => {
    if (c.perPaycheckCents >= -input.withheldPerPaycheckCents) return c;
    const rate = step4bRate(input.marginalRate);
    const amount = floorTo(
      (input.withheldPerPaycheckCents * perYear) / rate,
      WITHHOLDING.roundDeductionCents,
    );
    const per = perPaycheckEffect("4b", amount, rate, perYear);
    return {
      step: "4b",
      amountCents: amount,
      perPaycheckCents: per,
      refundAfterCents: refundCents + per * paychecks,
    };
  };
  const gap = target - refundCents;
  // A 0% top rate: Step 4(b) would be sized from nothing, and would change nothing.
  if (gap < 0 && !(input.marginalRate > 0)) return { status: "unknown", why: "no_rate" };
  let thisYear: W4Change | null = null;
  if (input.paychecksLeft > 0) {
    thisYear = limited(
      change(gap, input.paychecksLeft, perYear, input.marginalRate, refundCents),
      input.paychecksLeft,
    );
  }
  // Taxes QA: late in the year, handing back a big refund through a few paychecks can take
  // Step 4(b) deductions larger than the year's wages; then only the January change is offered.
  if (
    thisYear?.step === "4b" &&
    input.wagesCents !== undefined &&
    thisYear.amountCents > input.wagesCents
  ) {
    thisYear = null;
  }
  // A full year with the same pay: the whole year's gap spread over every paycheck.
  const fromJanuary = limited(
    change(gap, perYear, perYear, input.marginalRate, refundCents),
    perYear,
  );
  return {
    status: big ? "big_refund" : "bill_coming",
    refundCents,
    lastYearRefundCents: input.lastYearRefundCents,
    targetCents: target,
    paychecksLeft: input.paychecksLeft,
    perYear,
    thisYear,
    fromJanuary,
  };
}
