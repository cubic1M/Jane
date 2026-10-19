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
  | { kind: "payoff_plan"; extraCents: number | null };

const DEBT_KINDS = new Set<string>(["debts", "debt_detail", "payoff_plan"]);
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
