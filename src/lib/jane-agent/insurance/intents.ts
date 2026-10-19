import type { PolicyKind } from "@/config/insurance";

// Questions about insurance, understood by rules (spec Phase X). Pure: the normalized text
// (src/lib/jane-agent/intents.ts normalize) in, an insurance intent or null out.

// cover: what a policy covers and its limits. renew: when it renews. cost: what it costs.
// deductible: its deductible. gaps: what looks missing. list: every policy on file.
// quotes: compare prices from the insurance partner (spec step 103). switch: how a switch
// Jane is doing is going (spec step 105). checkup: is the cover right, by rules (step 106).
export type InsuranceAsk =
  | "cover"
  | "renew"
  | "cost"
  | "deductible"
  | "gaps"
  | "list"
  | "quotes"
  | "switch"
  | "checkup"
  // claim: something happened (spec step 107).
  | "claim";

export type InsuranceIntent = {
  kind: "insurance";
  ask: InsuranceAsk;
  // The kind of policy the person named, if any.
  policyKind: PolicyKind | null;
  // Spec step 107: what happened, by the claim guide's event key (src/config/claims.ts).
  event?: string;
};

// Something happened (spec step 107): the kind of policy it's for and the guide's event.
// Home covers home and renters alike; the answer picks the policy the person has.
const CLAIM_EVENTS: readonly [PolicyKind, string, RegExp][] = [
  [
    "auto",
    "theft",
    /\b(?:car|truck)\b.*\b(?:stolen|broken into|broke into)\b|\bstole my (?:car|truck)\b/,
  ],
  [
    "auto",
    "accident",
    /\b(?:car accident|accident|crash(?:ed)?|fender bender|rear-?ended|t-?boned|totaled|hit (?:my|a|another|someone'?s) car|(?:car|truck) (?:was|got) hit)\b/,
  ],
  ["auto", "damage", /\b(?:hail|cracked|chipped) (?:windshield|car)\b|\bwindshield\b/],
  [
    "home",
    "break_in",
    /\b(?:broke in|broke into|broken into|break-?in|burglar\w*|burglary|robbed)\b/,
  ],
  [
    "home",
    "damage",
    /\b(?:fire|flood\w*|water damage|pipe burst|burst pipe|leak\w*|storm damage|roof damage|tree fell)\b/,
  ],
  ["home", "theft", /\b(?:stolen|got stolen|was stolen|theft)\b/],
  ["pet", "vet", /\bvet\b|\bmy (?:dog|cat|pet) (?:is|got|was) (?:sick|hurt|injured|ill)\b/],
  ["life", "death", /\b(?:died|passed away|death in the family)\b/],
  ["health", "bill", /\b(?:medical|hospital|doctor'?s?) bill\b/],
];
const CLAIM_ASK =
  /\b(?:file|make|start|open|need to (?:make|file)) (?:a |an )?(?:insurance )?claim\b|\bclaim\b/;

// "Am I covered if my car is stolen?" asks about cover; it isn't something that happened.
const HYPOTHETICAL = /\b(?:if|would|could|in case|what happens|am i covered|does my|is my)\b/;

export function parseClaim(text: string): InsuranceIntent | null {
  if (HYPOTHETICAL.test(text) && !CLAIM_ASK.test(text)) return null;
  const found = CLAIM_EVENTS.find(([, , words]) => words.test(text));
  if (found) return { kind: "insurance", ask: "claim", policyKind: found[0], event: found[1] };
  if (CLAIM_ASK.test(text)) return { kind: "insurance", ask: "claim", policyKind: kindIn(text) };
  return null;
}

const KIND_WORDS: readonly [PolicyKind, RegExp][] = [
  ["renters", /\brent(?:er'?s|al)\b/],
  ["auto", /\b(?:car|cars|auto|vehicle|motor)\b/],
  ["home", /\b(?:home|homeowners?'?|house|homeowner'?s)\b/],
  ["life", /\blife\b/],
  ["pet", /\b(?:pet|pets|dog|cat)\b/],
  ["health", /\b(?:health|medical)\b/],
];

// Words that make it about insurance on their own, and cover words that need a kind too
// ("does my budget cover rent" isn't about insurance; "am I covered if my car is stolen" is).
const INSURANCE =
  /\b(?:insurance|insured|insurer|insurers|polic(?:y|ies)|deductibles?|premiums?|(?:under|over)-?insured)\b/;
const COVER = /\b(?:cover|covers|covered|coverage)\b/;
// About the amount of cover, so about insurance even without the word (spec step 106).
const COVER_AMOUNT =
  /\b(?:right|wrong) amount of (?:cover|coverage)\b|\btoo (?:much|little) (?:cover|coverage)\b/;
// Whether the cover is right (spec step 106).
const CHECKUP =
  /\bcheck ?-?ups?\b|\b(?:check|review|look over) (?:my|our|the) (?:insurance|cover|coverage|policies|policy)\b|\b(?:right|wrong) amount of (?:cover|coverage|insurance)\b|\b(?:over|under)-?insured\b|\btoo much (?:cover|coverage|insurance)\b|\b(?:raise|lower|change) (?:my |the )?deductible\b/;

const ASKS: readonly [InsuranceAsk, RegExp][] = [
  [
    "switch",
    /\bswitch(?:ed|ing)?\b.*\b(?:going|status|done|yet|happen\w*|progress|over)\b|\bdid you (?:switch|change)\b|\bhow'?s (?:my|the) switch\b|\bis my (?:new )?(?:insurance|policy) (?:active|in place|done)\b/,
  ],
  ["checkup", CHECKUP],
  [
    "quotes",
    /\b(?:quotes?|compare|comparing|shop|shopping|reshop|cheaper|better (?:price|deal|rate)|lower price|best price|find me|switch)\b/,
  ],
  ["renew", /\b(?:renew|renews|renewal|renewing|expire|expires|expiry|run out|runs out)\b/],
  ["deductible", /\bdeductibles?\b/],
  ["gaps", /\b(?:missing|gaps?|enough|need any|do i need|am i covered enough|anything i need)\b/],
  ["cost", /\b(?:how much|cost|costs|paying|price|premiums?|a month|a year)\b/],
  ["cover", /\b(?:cover|covers|covered|coverage|limits?|include|includes|what does)\b/],
];

export function kindIn(text: string): PolicyKind | null {
  return KIND_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
}

export function parseInsurance(text: string): InsuranceIntent | null {
  // Something happened: the claims helper, whatever words were used.
  const claim = parseClaim(text);
  if (claim) return claim;
  const policyKind = kindIn(text);
  if (!INSURANCE.test(text) && !(COVER.test(text) && policyKind) && !COVER_AMOUNT.test(text)) {
    return null;
  }
  const ask = ASKS.find(([, words]) => words.test(text))?.[0] ?? "list";
  return { kind: "insurance", ask, policyKind };
}
