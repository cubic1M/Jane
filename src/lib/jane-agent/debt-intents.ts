// Questions about debts, understood by rules (spec Phase Y). Pure: normalized text in
// (./intents.ts normalize), a debt intent or null out. Wired into parseIntent.

export type DebtIntent =
  // Spec step 109: "how much do I owe?", every debt with its balance and rate.
  | { kind: "debts" }
  // "When is my car paid off?", "how much do I owe on my student loan?", "what's the rate
  // on my card?": one debt in full. target is the person's words for it.
  | { kind: "debt_detail"; target: string };

const DEBT_KINDS = new Set<string>(["debts", "debt_detail"]);
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

const clean = (target: string) =>
  target
    .replace(/\b(?:paid off|off|in full)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseDebtIntent(text: string): DebtIntent | null {
  // "Lower the rate on my card" is a request, not a question (./intents.ts act).
  if (/^(?:lower|reduce|cut|negotiate|bring down|shrink|cancel|refund)\b/.test(text)) return null;
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
