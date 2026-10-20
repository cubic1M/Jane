import type { RewardCategory } from "@/config/credit-cards";

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
  | { kind: "student_loans" }
  // Spec step 115: "can I get rid of PMI?", "my mortgage", "what if I pay extra on my house?".
  | { kind: "mortgage" }
  // Spec step 116: "what's my credit score?", "how do I improve my credit?".
  | { kind: "credit_score" }
  // Spec step 117: "what do you do about my debts?", "when are my debt payments due?".
  | { kind: "debt_autopilot" }
  | { kind: "debt_due" }
  // Spec step 174: "which card should I use for groceries?", "is my annual fee worth it?",
  // "what's the best credit card for me?".
  | { kind: "card_for"; category: RewardCategory | null }
  | { kind: "card_fee" }
  | { kind: "card_better" }
  // Spec step 175: "how do I build my credit?", "what would my score be if I paid my card off?".
  | { kind: "build_credit" }
  | { kind: "credit_simulate" }
  // Spec step 176: "what buy now pay later payments do I have?", "can I afford a $300 Klarna?".
  | { kind: "bnpl" }
  | { kind: "bnpl_new"; totalCents: number | null }
  // Spec step 177: "I'm short this month", "what if I can't pay my bills?".
  | { kind: "tight_money" }
  // Spec step 178: "how much car can I afford?", "the dealer offered 7.9% for 72 months".
  | { kind: "card_interest" }
  | { kind: "report_fixes" }
  | { kind: "medical_bills" }
  | { kind: "home_afford"; priceCents: number | null }
  | { kind: "car_afford"; priceCents: number | null }
  | {
      kind: "car_dealer";
      aprBps: number | null;
      termMonths: number | null;
      priceCents: number | null;
    };

const DEBT_KINDS = new Set<string>([
  "debts",
  "debt_detail",
  "payoff_plan",
  "refinance",
  "loan_status",
  "balance_transfer",
  "student_loans",
  "mortgage",
  "credit_score",
  "debt_autopilot",
  "debt_due",
  "card_for",
  "card_fee",
  "card_better",
  "build_credit",
  "credit_simulate",
  "bnpl",
  "bnpl_new",
  "tight_money",
  "car_afford",
  "car_dealer",
  "home_afford",
  "medical_bills",
  "report_fixes",
  "card_interest",
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
const MORTGAGE =
  /\b(?:pmi|escrow|private mortgage insurance)\b|\bmortgage\b|\b(?:extra|more) (?:principal|payments?)\b.*\b(?:house|home)\b/;
const CREDIT = /\bcredit (?:score|rating|report)\b|\bfico\b|\bcredit utili[sz]ation\b/;
// Spec step 175.
const BUILD_CREDIT =
  /\b(?:improve|raise|boost|build|rebuild|fix|grow|help) (?:my |our )?(?:credit|score|credit score)\b|\bbuilding (?:my )?credit\b|\bcredit[- ]builder\b|\bthin (?:credit )?file\b|\bon[- ]time streak\b|\bstatement (?:date|close|closes|closing)\b/;
const SIMULATE =
  /\bwhat (?:would|will|happens to) (?:my |our )?(?:credit )?score\b|\b(?:score|credit) simulator\b|\bsimulate (?:my )?(?:credit|score)\b|\bhow (?:much|many points) (?:would|will|could) (?:my )?(?:credit )?score\b|\bwhat if (?:i|we)\b.*\bscore\b/;
const DEBT_AUTOPILOT =
  /\bwhat (?:do|will|can) you do (?:about|with|for) (?:my )?(?:debts?|loans|cards)\b|\b(?:debt|loan) autopilot\b|\bautopilot (?:for|on) (?:my )?(?:debts?|loans)\b/;
const DEBT_DUE =
  /\bwhen (?:are|is) (?:my )?(?:debt|loan|card|credit card)s? (?:payments? )?due\b|\b(?:debt|loan|card) payments? (?:due|coming up)\b|\bnext (?:debt|loan|card) payment\b|\bmove (?:my )?(?:due date|payment date)\b/;
const LOAN_STATUS =
  /\b(?:loan )?application(?:'s| is)?(?: status)?\b|\bdid (?:the|my) (?:new )?loan (?:go through|fund|come through)\b|\b(?:status of|where'?s|how'?s) (?:my |the )?(?:new )?loan\b/;
// "Apply for the refinance": the pick and its Apply button.
const APPLY = /^apply\b|\bapply (?:for|with|to)\b/;

// Spec step 174.
const CARD_FOR =
  /\bwhich (?:credit )?card (?:should|do|would|to|can) (?:i |we )?(?:use|pay with|put)\b|\bwhat card (?:should|do) (?:i|we) use\b|\bbest card (?:for|to use)\b|\bwhich card (?:for|earns)\b/;
const CARD_FEE =
  /\bannual fees?\b|\bis (?:my )?(?:credit )?card(?:'s)? fee worth\b|\bis (?:my )?(?:credit )?card worth (?:it|the fee|keeping)\b/;
const CARD_BETTER =
  /\b(?:best|better|new|another|right) (?:credit |rewards )?card(?: for me)?\b|\bwhich credit card should (?:i|we) (?:get|apply)\b|\bcard rewards?\b|\bcash ?back card\b|\brewards card\b|\bcredit card rewards?\b/;
const CARD_KINDS: readonly [RegExp, RewardCategory][] = [
  [/\bgrocer/, "groceries"],
  [/\b(?:gas|fuel)\b/, "gas"],
  [/\b(?:dining|restaurants?|eating out|takeout|coffee|food)\b/, "dining"],
  [/\b(?:travel|flights?|hotels?|ubers?|rides?|taxis?)\b/, "travel"],
  [/\b(?:streaming|netflix|spotify|subscriptions?)\b/, "streaming"],
  [/\b(?:online|amazon)\b/, "online"],
  [/\b(?:everything else|everything|other)\b/, "other"],
];
const cardKind = (text: string) => CARD_KINDS.find(([re]) => re.test(text))?.[1] ?? null;

// Spec step 176.
const BNPL_WORD = /\b(?:klarna|affirm|afterpay|buy now,? pay later|bnpl|pay in 4|pay in four)\b/;
const BNPL_NEW =
  /\b(?:afford|take on|start|open|add|get|use|worth)\b.*\b(?:klarna|affirm|afterpay|buy now,? pay later|bnpl|pay in 4|pay in four|installments?)\b|\b(?:klarna|affirm|afterpay|buy now,? pay later|bnpl|pay in 4)\b.*\b(?:afford|strain|squeeze)\b/;
const BNPL_LIST =
  /\b(?:installments?|buy now,? pay later|bnpl|klarna|affirm|afterpay|pay in 4)\b.*\b(?:coming|due|next|payments?|plans?|do i have|owe|list|all)\b|\b(?:coming|due|next|my)\b.*\b(?:installments?|buy now,? pay later|bnpl|klarna|affirm|afterpay)\b/;

// Spec step 177.
const TIGHT =
  /\b(?:money is tight|money'?s tight|tight (?:month|on money)|i'?m (?:short|broke|strapped)|(?:can'?t|cannot|won'?t be able to|unable to) (?:afford|pay|make) (?:my |the |all my |this month'?s )?(?:bills?|rent|payments?|mortgage|cards?)|short on (?:cash|money)|running out of money|hardship (?:program|help|plan)|(?:behind|struggling) (?:on|with) (?:my )?(?:bills|payments|debts?))\b/;

// Spec step 178.
const CAR_WORD = /\b(?:car|cars|vehicle|truck|suv|minivan|sedan)\b/;
const CAR_DEALER =
  /\bdealer(?:ship)?(?:'s)?\b.*\b(?:financ\w*|loan|offer\w*|rate|apr|quot\w*)\b|\b(?:financ\w*|loan|offer\w*|rate|apr)\b.*\bdealer(?:ship)?\b/;
const CAR_AFFORD =
  /\b(?:afford|buy|buying|get|getting|budget|price range)\b|\bhow much (?:car|truck|suv|vehicle)\b|\b(?:car|auto|vehicle) loan\b.*\b(?:preapprov\w*|pre-approv\w*|offers?|compare|quotes?|rates?)\b|\bpre-?approv\w*\b/;
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|percent|apr)/;
const MONTHS = /(\d{2,3})\s*(?:months?|mos?\b)/;

// Spec step 179: buying a home (not a mortgage already owned, nor home insurance or equity).
const HOME_WORD = /\b(?:house|home|condo|townhouse|townhome|first home|apartment)\b/;
const HOME_BUY =
  /\b(?:afford|buy|buying|purchase|purchasing|down payment|closing costs?|pre-?approv\w*|mortgage offers?|price range|budget|first[- ]time)\b|\bhow much (?:house|home)\b|\bsave for (?:a |my )?(?:house|home)\b/;
const HOME_NOT = /\b(?:insurance|equity|my mortgage|refinanc\w*|pay off|payoff|rent)\b/;

// Spec step 180: medical bills (not medical expenses for taxes, nor insurance claims).
const MEDICAL_BILL =
  /\b(?:medical|hospital|doctor'?s?|dentist|dental|er|ambulance|surgery|lab|clinic)\b.*\b(?:bills?|charges?|debt|invoice|owe)\b|\b(?:bills?|charges?)\b.*\b(?:from|for) (?:the |my )?(?:hospital|doctor|dentist|er|clinic|ambulance|surgery|lab)\b|\bitemi[sz]ed bill\b|\bfinancial assistance\b|\bcharity care\b/;
// A surprise or denied bill is an insurance claim (its own intent).
const MEDICAL_NOT =
  /\b(?:claim|claims|insurance claim|surprise|denied|deduct\w*|hsa|fsa|tax|taxes|premium)\b/;

// Spec step 181: collections and errors on the credit report.
const REPORT_FIX =
  /\b(?:collections?|collection agency|debt collector|collector)\b|\b(?:error|errors|mistake|mistakes|wrong|incorrect|inaccurate)\b.*\b(?:credit report|credit file)\b|\bcredit report\b.*\b(?:error|errors|mistake|mistakes|wrong|incorrect|inaccurate|dispute)\b|\bdispute\b.*\b(?:credit|bureau|bureaus|equifax|experian|transunion)\b|\bdebt validation\b|\bvalidat\w+ (?:the |a |this )?debt\b|\bfix my credit report\b/;

// Spec step 224: card interest, 0% promotions and asking for a lower card rate.
const CARD_INTEREST =
  /\b(?:how much )?interest\b.*\b(?:cards?|credit cards?)\b|\b(?:cards?|credit cards?)\b.*\binterest\b|\b(?:pay|paying) less interest\b|\b(?:cut|reduce|lower|lowering) (?:my )?(?:card |credit card )?(?:interest|apr)\b|\bdeferred interest\b|\b0 ?% (?:promo|promotion|offer|intro)\b|\bpromo(?:tional)? (?:balance|rate|period|ends)\b/;

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
  if (DEBT_AUTOPILOT.test(text)) return { kind: "debt_autopilot" };
  if (TIGHT.test(text)) return { kind: "tight_money" };
  if (
    CARD_INTEREST.test(text) &&
    !/\b(?:mortgage|student|car loan|auto|home|transfer|balance transfer)\b/.test(text)
  ) {
    return { kind: "card_interest" };
  }
  if (REPORT_FIX.test(text) && !/\b(?:tax|taxes)\b/.test(text)) return { kind: "report_fixes" };
  if (MEDICAL_BILL.test(text) && !MEDICAL_NOT.test(text)) return { kind: "medical_bills" };
  if (
    HOME_WORD.test(text) &&
    HOME_BUY.test(text) &&
    !HOME_NOT.test(text) &&
    (amountCents === null || amountCents >= 5_000_000)
  ) {
    return { kind: "home_afford", priceCents: amountCents };
  }
  if (
    /\b(?:down payment|closing costs?|pre-?approv\w* for a mortgage|mortgage pre-?approv\w*)\b/.test(
      text,
    ) &&
    !HOME_NOT.test(text)
  ) {
    return { kind: "home_afford", priceCents: amountCents };
  }
  if (CAR_DEALER.test(text) && (CAR_WORD.test(text) || PERCENT.test(text))) {
    const apr = PERCENT.exec(text);
    const months = MONTHS.exec(text);
    return {
      kind: "car_dealer",
      aprBps: apr ? Math.round(Number(apr[1]) * 100) : null,
      termMonths: months ? Number(months[1]) : null,
      priceCents: amountCents,
    };
  }
  if (
    CAR_WORD.test(text) &&
    !/\b(?:insurance|refinanc\w*|payoff|pay off)\b/.test(text) &&
    CAR_AFFORD.test(text) &&
    // A small amount is a "can I afford" question (a used car, a repair), not a purchase plan.
    (amountCents === null || amountCents >= 500_000)
  ) {
    return { kind: "car_afford", priceCents: amountCents };
  }
  if (BNPL_WORD.test(text) || /\binstallments?\b/.test(text)) {
    if (BNPL_NEW.test(text)) return { kind: "bnpl_new", totalCents: amountCents };
    if (BNPL_LIST.test(text)) return { kind: "bnpl" };
  }
  if (SIMULATE.test(text)) return { kind: "credit_simulate" };
  if (BUILD_CREDIT.test(text)) return { kind: "build_credit" };
  if (CARD_FOR.test(text)) return { kind: "card_for", category: cardKind(text) };
  if (CARD_FEE.test(text)) return { kind: "card_fee" };
  if (CARD_BETTER.test(text) && !/\b0 ?%|balance transfer/.test(text)) {
    return { kind: "card_better" };
  }
  if (DEBT_DUE.test(text)) return { kind: "debt_due" };
  if (CREDIT.test(text)) return { kind: "credit_score" };
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
  // After refinancing ("refinance my mortgage"); a payoff date stays the debt itself.
  if (MORTGAGE.test(text) && !PAID_OFF.test(text) && !RATE.test(text) && !OWE.test(text)) {
    return { kind: "mortgage" };
  }
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
