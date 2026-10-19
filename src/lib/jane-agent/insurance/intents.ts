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
  | "claim"
  // autopilot: what Jane does with insurance by herself; contact: how to reach the insurer
  // (spec step 108).
  | "autopilot"
  | "contact"
  // need: "do I need umbrella insurance?", answered from their numbers (spec step 149).
  | "need"
  // benefits: cover through work (spec step 150).
  | "benefits"
  // documents: policies Jane read from documents, to confirm (spec step 151).
  | "documents"
  // cards: cover that comes with the person's cards (spec step 152).
  | "cards"
  // life: how much life cover, applied for and bought (spec step 153).
  | "life";

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
  // Spec step 149: the kinds added to the profile come first, so "my phone was stolen" isn't
  // a home theft.
  ["device", "theft", /\b(?:phone|laptop|tablet) (?:was |got )?(?:stolen|lost)\b/],
  [
    "device",
    "broken",
    /\bmy (?:phone|laptop|tablet) (?:broke|is broken|got (?:wet|damaged))\b|\bcracked (?:my )?(?:phone|screen)\b/,
  ],
  [
    "travel",
    "cancelled",
    /\b(?:flight|trip) (?:was |got )?cancell?ed\b|\bcancell?ed (?:my|our) trip\b/,
  ],
  ["travel", "medical", /\b(?:sick|hurt|injured|hospital) (?:abroad|on (?:my|our|the) trip)\b/],
  ["disability", "unable", /\bcan'?t work\b|\bunable to work\b|\bout of work (?:sick|injured)\b/],
  ["umbrella", "sued", /\b(?:being sued|suing me|sued me|sue me)\b/],
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
  // Spec step 149.
  ["umbrella", /\bumbrella\b/],
  ["disability", /\bdisabilit(?:y|ies)\b|\bincome protection\b/],
  ["travel", /\btravel\b|\btrip (?:insurance|cover)\b/],
  ["device", /\bdevice\b|\bphone (?:insurance|protection)\b/],
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
  /\b(?:insurance|insured|insurer|insurers|polic(?:y|ies)|deductibles?|premiums?|(?:under|over)-?insured|(?:health|medical) plans?|benefits?\b.{0,30}\b(?:work|job|employer)|(?:work|job|employer) benefits|open enrollment|declarations? pages?|renewal notices?)\b/;
// Cover that comes with a card (spec step 152): about insurance even without the word.
const CARD_COVER =
  /\bcards?\b.{0,30}\b(?:covers?|covered|coverage|protection|benefits?|warrant(?:y|ies)|insurance)\b|\b(?:cell )?phone protection\b|\brental car (?:cover|coverage|insurance)\b|\bextended warrant(?:y|ies)\b|\bpaying twice\b/;
const COVER = /\b(?:cover|covers|covered|coverage)\b/;
// About the amount of cover, so about insurance even without the word (spec step 106).
const COVER_AMOUNT =
  /\b(?:right|wrong) amount of (?:cover|coverage)\b|\btoo (?:much|little) (?:cover|coverage)\b/;
// Whether the cover is right (spec step 106).
const CHECKUP =
  /\bcheck ?-?ups?\b|\b(?:check|review|look over) (?:my|our|the) (?:insurance|cover|coverage|policies|policy)\b|\b(?:right|wrong) amount of (?:cover|coverage|insurance)\b|\b(?:over|under)-?insured\b|\btoo much (?:cover|coverage|insurance)\b|\b(?:raise|lower|change) (?:my |the )?deductible\b/;

// Sizing, applying for or buying life cover (spec step 153), even with "need" in it.
const LIFE =
  /\b(?:how much|apply(?:ing)?|buy(?:ing)?|get(?:ting)?|sign up)\b.{0,30}\b(?:life (?:insurance|cover|policy)|term life)\b|\b(?:life (?:insurance|cover)|term life)\b.{0,30}\b(?:how much|enough|apply|buy|should i get)\b/;

const ASKS: readonly [InsuranceAsk, RegExp][] = [
  ["cards", CARD_COVER],
  [
    "documents",
    /\b(?:read|upload\w*|scan\w*|sent you)\b.{0,30}\b(?:polic(?:y|ies)|declarations?|renewal notices?|documents?)\b|\bdeclarations? pages?\b|\brenewal notices?\b|\bpolicy documents?\b/,
  ],
  [
    "benefits",
    /\bbenefits?\b|\bthrough (?:work|my job)\b|\bat work\b|\bmy (?:employer|job)\b|\bopen enrollment\b/,
  ],
  [
    "autopilot",
    /\b(?:autopilot|on your own|by yourself|automatic(?:ally)?|without asking|what do you do|what will you do|what are you doing)\b/,
  ],
  [
    "contact",
    /\b(?:contact|phone number|claims? (?:line|number|phone)|call (?:my|the) (?:insurer|insurance)|reach (?:my|the) (?:insurer|insurance))\b/,
  ],
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

const NEED =
  /\b(?:do (?:i|we) need|should (?:i|we) (?:get|buy|have|add)|is (?:it|\w+ insurance) worth|worth (?:it|getting|having)|do (?:i|we) have to have)\b/;

export function parseInsurance(text: string): InsuranceIntent | null {
  // Something happened: the claims helper, whatever words were used.
  const claim = parseClaim(text);
  if (claim) return claim;
  const policyKind = kindIn(text);
  if (
    !INSURANCE.test(text) &&
    !(COVER.test(text) && policyKind) &&
    !COVER_AMOUNT.test(text) &&
    !CARD_COVER.test(text) &&
    !LIFE.test(text)
  ) {
    return null;
  }
  if (LIFE.test(text)) return { kind: "insurance", ask: "life", policyKind };
  // Spec step 149: whether they need a kind of cover, from their numbers.
  if (policyKind && NEED.test(text)) return { kind: "insurance", ask: "need", policyKind };
  const ask = ASKS.find(([, words]) => words.test(text))?.[0] ?? "list";
  return { kind: "insurance", ask, policyKind };
}
