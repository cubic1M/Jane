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
  | { kind: "tax"; ask: "bracket" };

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
const ESTIMATE =
  /\bhow much (?:tax )?(?:will|do|would) (?:i|we) (?:owe|get back|pay in tax(?:es)?|have to pay in tax(?:es)?)\b|\b(?:will|do) (?:i|we) (?:owe|get a refund|get money back)\b|\btax (?:estimate|bill|refund)\b|\bestimated? (?:tax|refund)\b|\bwhat (?:will|do) (?:i|we) owe (?:in |the )?(?:tax|taxes|irs)\b|\brefund this year\b/;
const BRACKET = /\btax bracket\b|\bmarginal (?:tax )?rate\b|\bwhat bracket\b|\bmy bracket\b/;
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
  if (BRACKET.test(text)) return { kind: "tax", ask: "bracket" };
  if (ESTIMATE.test(text)) return { kind: "tax", ask: "estimate" };
  if (FORMS.test(text)) return { kind: "tax", ask: "forms" };
  if (TAGS.test(text)) return { kind: "tax", ask: "tags" };
  if (DONATIONS.test(text)) return { kind: "tax", ask: "tag_total", tag: "donation" };
  const total = TAG_TOTAL.exec(text);
  if (total) return { kind: "tax", ask: "tag_total", tag: TAG_WORDS[total[1]] };
  if (PROFILE.test(text)) return { kind: "tax", ask: "profile" };
  return null;
}
