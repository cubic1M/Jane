import { US_STATES } from "@/config/referrals";
import type { FilingStatus, TaxTagKind } from "@/config/tax";

// What the person typed about taxes (spec steps 118–127), understood by rules. Pure: the
// normalized text in (./intents.ts normalize), a tax intent out, or null when it isn't
// about taxes. Typing never changes anything by itself: each answer offers a button.

export type TaxIntent =
  | { kind: "tax"; ask: "profile" }
  // status null: "I'm married", which could be either way.
  | { kind: "tax"; ask: "set_filing"; status: FilingStatus | null }
  | { kind: "tax"; ask: "set_kids"; count: number }
  | { kind: "tax"; ask: "set_state"; state: string }
  // Spec step 119: the tags, one tag's total, tagging a merchant, the forms, the pack.
  | { kind: "tax"; ask: "tags" }
  | { kind: "tax"; ask: "tag_total"; tag: TaxTagKind }
  | { kind: "tax"; ask: "tag"; target: string; tag: TaxTagKind | null }
  | { kind: "tax"; ask: "forms" }
  | { kind: "tax"; ask: "pack" }
  // Spec step 120: the estimate and the top rate.
  | { kind: "tax"; ask: "estimate" }
  | { kind: "tax"; ask: "bracket" }
  // Spec step 121: the withholding checkup.
  | { kind: "tax"; ask: "withholding" }
  // Spec step 122: ways to pay less.
  | { kind: "tax"; ask: "savings" }
  // Spec step 123: freelancers.
  | { kind: "tax"; ask: "quarterly" }
  | { kind: "tax"; ask: "set_aside" }
  | { kind: "tax"; ask: "home_office" }
  | { kind: "tax"; ask: "miles"; miles: number | null }
  // Spec step 125.
  | { kind: "tax"; ask: "refund" }
  // Spec step 126.
  | { kind: "tax"; ask: "file" }
  // Spec step 127.
  | { kind: "tax"; ask: "standard_deduction" }
  // Spec step 124.
  | { kind: "tax"; ask: "investments" };

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  no: 0,
  zero: 0,
  none: 0,
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const PROFILE =
  /\btax profile\b|\bmy filing status\b|\bwhat do you know about my tax(?:es)?\b|^(?:my )?tax(?:es)?$|\bset up my tax(?:es)?\b|\bwith (?:my )?tax(?:es)?$|\bget (?:my )?tax(?:es)? (?:ready|sorted|done)\b/;

const FILING: readonly [RegExp, FilingStatus][] = [
  [
    /\bmarried filing (?:jointly|joint(?:ly)?|together)\b|\bfile jointly\b|\bfiling jointly\b/,
    "married_joint",
  ],
  [/\bmarried filing separately\b|\bfile separately\b|\bfiling separately\b/, "married_separate"],
  [/\bhead of (?:the )?household\b/, "head_of_household"],
  [/\b(?:i'?m|i am|i'll be|i will be|file as|filing as|status is) single\b/, "single"],
];
const MARRIED = /^(?:i'?m|i am|we'?re|we are|i got|we got) (?:now )?married$/;

const KIDS =
  /\bi(?: have| got| claim| will claim|'ll claim) (\d{1,2}|no|zero|a|one|two|three|four|five|six) (?:kids?|children|child|dependents?|dependants?)\b/;

const STATE = /\b(?:i|we) (?:live|moved|file|reside|am|'m) (?:in|to) ([a-z][a-z .]{1,30})$/;

const TAGS =
  /\btax tags?\b|\btagged for (?:my )?tax(?:es)?\b|\bwhat(?:'s| is| have you| did you) tag(?:ged)?\b/;
const DONATIONS =
  /\bhow much (?:have i|did i|i've) (?:given|give|donated?)\b|\b(?:my )?(?:donations|charity|charitable giving|giving) (?:this year|so far|total)\b|\bdonated (?:this year|so far)\b/;
const TAG_TOTAL =
  /\b(medical|childcare|education|work) (?:expenses? |costs? |spending |bills )?(?:for (?:my )?tax(?:es)?|tagged|this year for tax(?:es)?)\b/;
const TAG_WORDS: Readonly<Record<string, TaxTagKind>> = {
  donation: "donation",
  donations: "donation",
  charity: "donation",
  medical: "medical",
  childcare: "childcare",
  education: "education",
  work: "work",
  "work expense": "work",
  "work expenses": "work",
};
const TAG =
  /^tag (?:my |the |all )?(?:charges? (?:from|at) )?(.+?) (?:charges? |payments? |purchases? )?as (?:a |an )?(donations?|charity|medical|childcare|education|work(?: expenses?)?)$/;
const UNTAG =
  /^(?:untag|don't tag|do not tag|stop tagging) (?:my |the |all )?(.+?)(?: for tax(?:es)?)?$/;
const FORMS =
  /\b(?:tax )?(?:forms?|documents?|paperwork) (?:do i need|to expect|am i waiting (?:on|for)|should i (?:get|expect)|for (?:my )?tax(?:es)?)\b|\b(?:my |a |the )?(?:w-?2s?|1099s?|1098s?)\b/;
// About taxes, not debts: "how much do I owe" is the loans' question (step 109).
const ESTIMATE =
  /\bhow much (?:tax|taxes) (?:will|do|would) (?:i|we) (?:owe|pay)\b|\bhow much (?:tax )?(?:will|do|would) (?:i|we) (?:get back|pay in tax(?:es)?|have to pay in tax(?:es)?)\b|\b(?:will|do) (?:i|we) (?:get a refund|get money back)\b|\btax (?:estimate|bill|refund)\b|\bestimated? (?:tax|refund)\b|\brefund this year\b/;
// "How much do I owe?" is about debts (./debt-intents.ts) unless it says tax.
const OWE =
  /\bhow much (?:tax )?(?:will|do|would) (?:i|we) owe\b|\b(?:will|do|what (?:will|do)) (?:i|we) owe\b/;
const TAX_WORD = /\b(?:tax(?:es)?|irs|refund|return)\b/;
const BRACKET = /\btax bracket\b|\bmarginal (?:tax )?rate\b|\bwhat bracket\b|\bmy bracket\b/;
const WITHHOLDING =
  /\bw-?4\b|\bwithholding\b|\bwithhold(?:ing)? (?:enough|too much|too little|more|less)\b|\b(?:am i|are we) (?:having|getting) enough (?:tax )?(?:taken|withheld)\b|\btoo much (?:tax )?(?:taken out|withheld)\b/;
const SAVINGS =
  /\bpay less (?:in )?tax(?:es)?\b|\bsave (?:on|money on) (?:my )?tax(?:es)?\b|\btax savings?\b|\b(?:lower|reduce|cut) (?:my |our )?tax(?:es| bill)?\b|\btax (?:breaks?|deductions?|credits?)\b|\bwhat (?:can|could) i deduct\b|\bdeductions? (?:can|could) i (?:take|claim)\b/;
const QUARTERLY_ASK =
  /\b(?:quarterly|estimated) (?:tax(?:es)?|payments?|tax payments?)\b|\bself[- ]employment tax\b|\b1040-?es\b/;
const SET_ASIDE =
  /\bset aside\b.*\btax(?:es)?\b|\bhow much (?:should|do) i (?:save|put aside|set aside|keep) for tax(?:es)?\b/;
const HOME_OFFICE = /\bhome office\b/;
const MILES_ADD =
  /\b(?:i )?(?:drove|driven|log|add|record) (\d{1,3}(?:,\d{3})*|\d+) (?:business |work )?miles\b/;
const MILEAGE = /\b(?:business |work )?mileage\b|\bbusiness miles\b/;
const REFUND_ASK =
  /\bwhere(?:'s| is) my (?:tax )?refund\b|\b(?:did|has) my (?:tax )?refund (?:come|arrive|land|come in)\b|\bwhat (?:should|could) i do with my (?:tax )?refund\b|\bmy tax refund\b/;
const FILE =
  /\bfile (?:my |our )?(?:tax(?:es)?|return|tax return)\b|\b(?:my |our )?tax return\b|\btax deadline\b|\bwhen (?:are|is) (?:my |our )?tax(?:es)? due\b|\b(?:status of|where is) my return\b/;
const STANDARD = /\bstandard deduction\b/;
// Capital gains, harvesting and asset location in general are the investments lane's
// (step 135, ./investments/intents.ts); these are what step 124 adds.
const INVESTMENT_TAX =
  /\breali[sz]ed (?:gains?|losses?)\b|\bharvest (?:my )?loss(?:es)?\b|\bwash sales?\b|\b(?:gains|losses) (?:on|from) (?:my )?(?:sales|selling)\b/;
const PACK = /\btax(?:-| )?time pack\b|\btax pack\b|\byear-end pack\b/;

function stateCode(words: string): string | null {
  const w = words.trim().replace(/\.$/, "");
  const match = US_STATES.find((s) => s.name.toLowerCase() === w || s.code.toLowerCase() === w);
  return match?.code ?? null;
}

export function parseTaxIntent(text: string): TaxIntent | null {
  for (const [pattern, status] of FILING) {
    if (pattern.test(text)) return { kind: "tax", ask: "set_filing", status };
  }
  if (MARRIED.test(text)) return { kind: "tax", ask: "set_filing", status: null };
  const kids = KIDS.exec(text);
  if (kids) {
    const n = /^\d+$/.test(kids[1]) ? Number(kids[1]) : NUMBER_WORDS[kids[1]];
    if (n !== undefined) return { kind: "tax", ask: "set_kids", count: n };
  }
  const state = STATE.exec(text);
  if (state) {
    const code = stateCode(state[1]);
    if (code) return { kind: "tax", ask: "set_state", state: code };
  }
  const tag = TAG.exec(text);
  if (tag)
    return { kind: "tax", ask: "tag", target: tag[1].trim(), tag: TAG_WORDS[tag[2]] ?? "work" };
  const untag = UNTAG.exec(text);
  if (untag) return { kind: "tax", ask: "tag", target: untag[1].trim(), tag: null };
  if (PACK.test(text)) return { kind: "tax", ask: "pack" };
  if (STANDARD.test(text)) return { kind: "tax", ask: "standard_deduction" };
  if (INVESTMENT_TAX.test(text)) return { kind: "tax", ask: "investments" };
  if (REFUND_ASK.test(text)) return { kind: "tax", ask: "refund" };
  if (FILE.test(text)) return { kind: "tax", ask: "file" };
  if (WITHHOLDING.test(text)) return { kind: "tax", ask: "withholding" };
  if (SAVINGS.test(text)) return { kind: "tax", ask: "savings" };
  const miles = MILES_ADD.exec(text);
  if (miles) return { kind: "tax", ask: "miles", miles: Number(miles[1].replaceAll(",", "")) };
  if (MILEAGE.test(text)) return { kind: "tax", ask: "miles", miles: null };
  if (HOME_OFFICE.test(text)) return { kind: "tax", ask: "home_office" };
  if (SET_ASIDE.test(text)) return { kind: "tax", ask: "set_aside" };
  if (QUARTERLY_ASK.test(text)) return { kind: "tax", ask: "quarterly" };
  if (BRACKET.test(text)) return { kind: "tax", ask: "bracket" };
  if (ESTIMATE.test(text) || (OWE.test(text) && TAX_WORD.test(text))) {
    return { kind: "tax", ask: "estimate" };
  }
  if (FORMS.test(text)) return { kind: "tax", ask: "forms" };
  if (TAGS.test(text)) return { kind: "tax", ask: "tags" };
  if (DONATIONS.test(text)) return { kind: "tax", ask: "tag_total", tag: "donation" };
  const total = TAG_TOTAL.exec(text);
  if (total) return { kind: "tax", ask: "tag_total", tag: TAG_WORDS[total[1]] };
  if (PROFILE.test(text)) return { kind: "tax", ask: "profile" };
  return null;
}
