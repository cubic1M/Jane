import { US_STATES } from "@/config/referrals";
import type { FilingStatus } from "@/config/tax";

// What the person typed about taxes (spec steps 118–127), understood by rules. Pure: the
// normalized text in (./intents.ts normalize), a tax intent out, or null when it isn't
// about taxes. Typing never changes anything by itself: each answer offers a button.

export type TaxIntent =
  | { kind: "tax"; ask: "profile" }
  // status null: "I'm married", which could be either way.
  | { kind: "tax"; ask: "set_filing"; status: FilingStatus | null }
  | { kind: "tax"; ask: "set_kids"; count: number }
  | { kind: "tax"; ask: "set_state"; state: string };

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
  if (PROFILE.test(text)) return { kind: "tax", ask: "profile" };
  return null;
}
