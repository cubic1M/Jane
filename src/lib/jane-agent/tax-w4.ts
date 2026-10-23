import { IRS_W4_URL, IRS_WITHHOLDING_ESTIMATOR_URL } from "@/config/tax";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { formatCents } from "@/lib/money";
import type { W4Change, WithholdingCheck } from "@/planning/withholding";
import { balancePhrase, roundDollars } from "@/planning/tax-estimate-copy";
import { snoozeButton } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// The withholding checkup in the chat (spec step 121). In demo advice mode: what to put on
// a new W-4 and a three-step walk-through in one message; Jane never sends it, the person
// does and says so. Otherwise: the comparison and the IRS's own estimator.

export type W4Message = { body: string; actions: MessageAction[]; refs: MessageRefs };

const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});

const stepName = (c: W4Change) =>
  c.step === "4b" ? "Step 4(b), Deductions" : "Step 4(c), Extra withholding";
const amount = (c: W4Change) =>
  c.step === "4b"
    ? `${formatCents(c.amountCents)} a year`
    : `${formatCents(c.amountCents)} a paycheck`;
const perPaycheck = (c: W4Change) =>
  c.perPaycheckCents < 0
    ? `about ${roundDollars(-c.perPaycheckCents)} more in each paycheck`
    : `about ${roundDollars(c.perPaycheckCents)} less in each paycheck`;

type Actionable = Extract<WithholdingCheck, { status: "big_refund" | "bill_coming" }>;

// The suggestion, with Walk me through it.
export function w4Suggestion(view: TaxEstimateView, check: Actionable): W4Message {
  const now = check.thisYear;
  const lastYear =
    check.status === "big_refund" && check.lastYearRefundCents
      ? `, and you got ${roundDollars(check.lastYearRefundCents)} back last year`
      : "";
  const opening =
    check.status === "big_refund"
      ? `You're on course for ${balancePhrase(check.refundCents)} for ${view.year}${lastYear}. That's your own money, held until next spring: a new W-4 would put it in your paychecks instead.`
      : `You're heading for ${balancePhrase(check.refundCents)} for ${view.year}. A new W-4 that withholds a little more would turn it into a small refund.`;
  const plan = now
    ? ` For your last ${check.paychecksLeft} ${check.paychecksLeft === 1 ? "paycheck" : "paychecks"} this year, put ${amount(now)} in ${stepName(now)} (${perPaycheck(now)}, leaving ${balancePhrase(now.refundAfterCents)}); from January, ${amount(check.fromJanuary)}.`
    : check.paychecksLeft > 0
      ? ` With ${check.paychecksLeft} ${check.paychecksLeft === 1 ? "paycheck" : "paychecks"} left this year, getting it back through them would take more deductions than your pay, so it comes as your refund in the spring. From January, put ${amount(check.fromJanuary)} in ${stepName(check.fromJanuary)} (${perPaycheck(check.fromJanuary)}).`
      : ` From January, put ${amount(check.fromJanuary)} in ${stepName(check.fromJanuary)} (${perPaycheck(check.fromJanuary)}).`;
  const change = now ?? check.fromJanuary;
  return {
    body: `${opening}${plan} Want me to walk you through it?`,
    actions: [
      { id: "tax.w4_start", label: "Walk me through it", kind: "primary" },
      ...(check.status === "big_refund"
        ? [{ id: "tax.w4_keep" as const, label: "Keep my refund", kind: "secondary" as const }]
        : []),
      snoozeButton(),
    ],
    refs: {
      advice: true,
      w4Step: change.step,
      w4AmountCents: change.amountCents,
      w4JanuaryCents: check.fromJanuary.amountCents,
    },
  };
}

// The walk-through, one step at a time in the same message.
export function w4Step(n: 1 | 2 | 3, refs: MessageRefs): W4Message {
  const step = refs.w4Step === "4c" ? "4c" : "4b";
  const cents = refs.w4AmountCents ?? 0;
  const where =
    step === "4b"
      ? `in Step 4(b), Deductions, put ${formatCents(cents)}`
      : `in Step 4(c), Extra withholding, put ${formatCents(cents)}`;
  const next = (label: string): MessageAction[] => [
    { id: "tax.w4_next", label, kind: "primary" },
    { id: "tax.w4_stop", label: "Stop", kind: "secondary" },
  ];
  switch (n) {
    case 1:
      return {
        body: "Step 1 of 3: get a new Form W-4 from your employer's payroll site or HR. It's the IRS's form, the same everywhere.",
        actions: [...next("Got it, next"), link("The W-4 on irs.gov", IRS_W4_URL)],
        refs: { ...refs, w4Flow: 1 },
      };
    case 2:
      return {
        body: `Step 2 of 3: keep Steps 1 to 3 as they are now, and ${where}. Leave the other parts of Step 4 as they are.`,
        actions: next("Done, next"),
        refs: { ...refs, w4Flow: 2 },
      };
    case 3:
      return {
        body: "Step 3 of 3: sign it and give it to payroll. It usually starts in a paycheck or two. Tell me when you've sent it and I'll count it in your estimate.",
        actions: [
          { id: "tax.w4_sent", label: "I've sent it", kind: "primary" },
          { id: "tax.w4_stop", label: "Stop", kind: "secondary" },
        ],
        refs: { ...refs, w4Flow: 3 },
      };
  }
}

// For real accounts: the comparison, and where to work it out.
export function withholdingFacts(view: TaxEstimateView, check: Actionable): W4Message {
  return {
    body:
      check.status === "big_refund"
        ? `Your withholding is ahead of your tax: I estimate ${balancePhrase(check.refundCents)} for ${view.year}. The IRS's Tax Withholding Estimator shows what to put on a new W-4 if you'd rather have it in your paychecks.`
        : `Your withholding is behind your tax: I estimate ${balancePhrase(check.refundCents)} for ${view.year}. The IRS's Tax Withholding Estimator shows what to put on a new W-4 to catch up.`,
    actions: [
      link("Tax Withholding Estimator", IRS_WITHHOLDING_ESTIMATOR_URL),
      link("See the estimate", "/taxes#withholding"),
    ],
    refs: {},
  };
}

export function onTrackLine(view: TaxEstimateView, refundCents: number): string {
  return `Your withholding looks about right: I estimate ${balancePhrase(refundCents)} for ${view.year}.`;
}
