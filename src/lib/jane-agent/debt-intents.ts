// Questions about debts, understood by rules (spec Phase Y). Pure: normalized text in
// (./intents.ts normalize), a debt intent or null out. Wired into parseIntent.

export type DebtIntent =
  // Spec step 109: "how much do I owe?", every debt with its balance and rate.
  | { kind: "debts" }
  // "When is my car paid off?", "how much do I owe on my student loan?", "what's the rate
  // on my card?": one debt in full. target is the person's words for it.
  | { kind: "debt_detail"; target: string }
  // Spec step 110: "what's the fastest way out of debt?", "what if I pay $200 more?".
  // extraCents is the extra a month they named, or null.
  | { kind: "payoff_plan"; extraCents: number | null }
  // Spec step 111: "can I refinance my car loan?", "find me a better rate". target is the
  // debt they named, or null for all of them.
  | { kind: "refinance"; target: string | null }
  // Spec step 112: "how's my loan application?".
  | { kind: "loan_status" }
  // Spec step 113: "should I do a balance transfer?", "0% card".
  | { kind: "balance_transfer" }
  // Spec step 114: "which student loan plan?", "PSLF", "income-driven repayment".
  | { kind: "student_loans" };

const DEBT_KINDS = new Set<string>([
  "debts",
  "debt_detail",
  "payoff_plan",
  "refinance",
  "loan_status",
  "balance_transfer",
  "student_loans",
]);
export const isDebtIntent = (intent: { kind: string }): intent is DebtIntent =>
  DEBT_KINDS.has(intent.kind);

const OWE =
  /\bhow much (?:do|does|did) (?:i|we) (?:still )?owe\b|\bhow much debt\b|\bwhat do (?:i|we) owe (?:in total|altogether|overall)\b|\b(?:my )?total (?:debt|owed)\b|\bwhat (?:are|is) (?:all )?my (?:debts?|loans)\b|\b(?:list|show)(?: me)? (?:all )?my (?:debts|loans)\b|\ball my debts?\b/;
// "… on my car", after a question about what's owed.
const ON = /\b(?:on|for) (?:my |the |our )?(.+)$/;
const PAID_OFF =
  /\bwhen (?:is|will|does|do|'s|are) (?:my |the |our )?(.+?) (?:be )?(?:paid off|paid down|paid for|done|finished|over)\b|\bwhen (?:do|will|can) (?:i|we) (?:finish paying|pay off|be done (?:with|paying)|be done paying off) (?:off )?(?:my |the |our )?(.+)$|\bpay ?off date (?:of|for|on) (?:my |the |our )?(.+)$/;
const RATE =
  /\b(?:what'?s |what is )?(?:the )?(?:interest rate|rate|apr) (?:on|for|of) (?:my |the |our )?(.+)$/;

const PAYOFF =
  /\b(?:payoff|pay off|pay-off|debt) plan\b|\b(?:fastest|quickest|best|cheapest|smartest) way (?:out of|to pay off|to pay down|to get out of|to clear) (?:my |all my |our )?(?:debts?|loans|cards)\b|\bhow (?:do|can|should|could) (?:i|we) (?:pay off|pay down|get out of|get rid of|clear) (?:my |all my |our )?(?:debts?|loans|cards)\b|\bdebt[- ]free\b|\bwhich (?:debt|loan|card|one) (?:should|do|would) (?:i|we) pay(?: off| down)? first\b|\bwhat (?:order|debt) (?:should|do) (?:i|we) pay\b/;
// "What if I pay $200 more a month?", "paying an extra $100 toward my debts".
const MORE =
  /\bwhat if (?:i|we) (?:pay|paid|put|added?)\b.*\b(?:more|extra)\b|\b(?:pay|paying|put|putting) (?:an )?extra\b.*\b(?:debts?|loans|cards|a month|each month|monthly)\b/;

const REFINANCE =
  /\brefinanc\w*\b|\brefi\b|\bbetter (?:rate|deal|loan|offer)s?\b|\bcheaper loans?\b|\b(?:loan|lender|rate) offers?\b|\bconsolidat\w*\b|\bshop (?:around )?for (?:a )?(?:loan|rate)s?\b/;
const REFINANCE_TARGET =
  /\b(?:on|for|of) (?:my |the |our )?(.+)$|\b(?:refinanc|consolidat)\w* (?:my |the |our )?(.+)$/;

const TRANSFER =
  /\bbalance transfers?\b|\b0 ?% (?:card|cards|transfer|apr|interest|intro)\b|\bzero percent\b|\bmove (?:my )?(?:credit )?card (?:debt|balance)\b|\btransfer (?:my )?(?:credit )?card(?: debt| balance)?\b|\btransfer (?:my )?balance\b/;
const STUDENT =
  /\b(?:idr|ibr|rap|pslf|income[- ]driven|income[- ]based|repayment assistance plan|public service loan forgiveness|studentaid)\b|\bstudent loans?\b.*\b(?:plans?|repay\w*|forgiv\w*|options?|lower|cheaper|best|income|switch)\b|\b(?:plans?|repay\w*|forgiv\w*|lower|reduce|cut)\b.*\bstudent loans?\b/;
const LOAN_STATUS =
  /\b(?:loan )?application(?:'s| is)?(?: status)?\b|\bdid (?:the|my) (?:new )?loan (?:go through|fund|come through)\b|\b(?:status of|where'?s|how'?s) (?:my |the )?(?:new )?loan\b/;
// "Apply for the refinance": the pick and its Apply button.
const APPLY = /^apply\b|\bapply (?:for|with|to)\b/;

const clean = (target: string) =>
  target
    .replace(/\b(?:paid off|off|in full)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseDebtIntent(
  text: string,
  amountCents: number | null = null,
): DebtIntent | null {
  // Taxes owed are the tax questions' (./tax-intents.ts).
  if (/\b(?:tax|taxes|irs|tax refund)\b/.test(text)) return null;
  // "Lower the rate on my card" is a request, not a question (./intents.ts act).
  if (/^(?:lower|reduce|cut|negotiate|bring down|shrink|cancel|refund)\b/.test(text)) return null;
  if (MORE.test(text) && amountCents !== null)
    return { kind: "payoff_plan", extraCents: amountCents };
  if (PAYOFF.test(text)) return { kind: "payoff_plan", extraCents: null };
  if (TRANSFER.test(text)) return { kind: "balance_transfer" };
  if (LOAN_STATUS.test(text)) return { kind: "loan_status" };
  if (APPLY.test(text) && !REFINANCE_TARGET.test(text)) return { kind: "refinance", target: null };
  if (REFINANCE.test(text)) {
    const on = REFINANCE_TARGET.exec(text);
    const target = on
      ? clean(on[1] ?? on[2]).replace(
          /^(?:(?:a|an|the) )?(?:refinanc\w*|refi|new loan|loan)\b(?: (?:on|for|of) (?:my |the |our )?)?/,
          "",
        )
      : "";
    return {
      kind: "refinance",
      target:
        target &&
        !/^(?:it|them|everything|all|anything|my debts?|debts?|loans|offers?|options?|rates?)$/.test(
          target,
        )
          ? target
          : null,
    };
  }
  if (STUDENT.test(text)) return { kind: "student_loans" };
  const paid = PAID_OFF.exec(text);
  if (paid) {
    const target = clean(paid[1] ?? paid[2] ?? paid[3] ?? "");
    return target ? { kind: "debt_detail", target } : { kind: "debts" };
  }
  const rate = RATE.exec(text);
  if (rate && clean(rate[1])) return { kind: "debt_detail", target: clean(rate[1]) };
  if (OWE.test(text)) {
    const on = ON.exec(text.slice(OWE.exec(text)!.index));
    const target = on ? clean(on[1]) : "";
    return target && !/^(?:everything|all|total|in total)$/.test(target)
      ? { kind: "debt_detail", target }
      : { kind: "debts" };
  }
  return null;
}
