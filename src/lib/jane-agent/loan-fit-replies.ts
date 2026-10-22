import { FIT_DEFAULT_AMOUNT_CENTS, FIT_NEED_LABELS, type FitNeed } from "@/config/fit";
import type { FitView } from "@/lib/fit";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answer to "what's the best loan for me?" (spec step 283), from the fit engine
// (src/lib/fit.ts): her pick first, with how sure she is, then the options to choose from. The
// pick is demo advice; the choice is theirs, and choosing never applies for anything.

export const LOAN_FIT_PAGE: MessageAction = {
  id: "open",
  label: "Compare your loan options",
  kind: "link",
  href: "/loans/refinance",
};

export function loanFitReply(view: FitView, assumedAmount: boolean): Reply {
  const what = FIT_NEED_LABELS[view.need];
  if (!view.available) {
    return {
      body: "I can't price loan offers for your accounts yet, because that needs a lending partner. When one is connected I'll pick the loan that fits you.",
      actions: [],
      refs: {},
    };
  }
  // Something to borrow, but no lender prices an amount this small: pay it down directly.
  if (
    view.amountCents > 0 &&
    view.options.length === 0 &&
    view.ineligible.length === 0 &&
    view.baseline
  ) {
    return {
      body: `No lender prices a loan as small as ${formatCents(view.amountCents)}, so ${view.baseline.label} is simplest to pay down directly.`,
      actions: [LOAN_FIT_PAGE],
      refs: { advice: true },
    };
  }
  if (view.amountCents <= 0 || (view.options.length === 0 && view.ineligible.length === 0)) {
    return {
      body: `I don't see ${view.need === "consolidation" ? "card debt to consolidate" : view.need === "refinance" ? "a loan or card to refinance" : "an amount to price"} yet. Tell me how much you'd borrow, like "the best personal loan for $8,000".`,
      actions: [LOAN_FIT_PAGE],
      refs: {},
    };
  }
  if (view.options.length === 0) {
    const lines = [
      `Nothing fits for ${what} right now: ${view.ineligible[0].reason}`,
      ...view.whatWouldHelp,
    ];
    return { body: lines.join(" "), actions: [LOAN_FIT_PAGE], refs: { advice: true } };
  }
  const pick = view.options.find((o) => o.id === view.pick)!;
  const caution = pick.comfortable
    ? []
    : [
        `None of these fits comfortably on your income, so I'd borrow less or wait; the lowest payment is ${formatCents(Math.min(...view.options.map((o) => o.paymentCents)))} a month.`,
      ];
  const lines = [
    `For ${what}${assumedAmount ? ` (I assumed ${formatCents(view.amountCents)}; tell me the real amount)` : ` of ${formatCents(view.amountCents)}`}, the one that fits you best: ${pick.headline}.${
      view.confidence ? ` ${view.confidence.percent}% sure: ${view.confidence.reason}.` : ""
    }`,
    ...caution,
    "Your options:",
    ...view.options.map((o) => `- ${o.headline}${o.id === view.pick ? " (my pick)" : ""}`),
  ];
  return { body: lines.join("\n"), actions: [LOAN_FIT_PAGE], refs: { advice: true } };
}

export const defaultAmount = (need: FitNeed) => FIT_DEFAULT_AMOUNT_CENTS[need];
