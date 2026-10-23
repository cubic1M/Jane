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
  | { status: "unknown"; why: "no_pay" | "no_withholding" }
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
  const rate = Math.max(marginalRate, 0.1);
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

  const gap = target - refundCents;
  let thisYear: W4Change | null = null;
  if (input.paychecksLeft > 0) {
    thisYear = change(gap, input.paychecksLeft, perYear, input.marginalRate, refundCents);
    // Never ask for less withheld than a paycheck has.
    if (thisYear.perPaycheckCents < -input.withheldPerPaycheckCents) {
      const amount = floorTo(
        (input.withheldPerPaycheckCents * perYear) / Math.max(input.marginalRate, 0.1),
        WITHHOLDING.roundDeductionCents,
      );
      const per = perPaycheckEffect("4b", amount, input.marginalRate, perYear);
      thisYear = {
        step: "4b",
        amountCents: amount,
        perPaycheckCents: per,
        refundAfterCents: refundCents + per * input.paychecksLeft,
      };
    }
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
  const fromJanuary = change(gap, perYear, perYear, input.marginalRate, refundCents);
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
