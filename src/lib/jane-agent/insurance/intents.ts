import { decisionKindOf, type DecisionKind } from "./decisions";
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
  | "life"
  // life_change: "I got married", "I bought a car": the cover changes it needs (spec step 154).
  | "life_change"
  // Spec step 155: asking the insurer for a better renewal rate, and a claim Jane files.
  | "renewal_call"
  | "file_claim"
  // savings: cheaper ways to pay for the same cover (spec step 196).
  | "savings"
  // risks: what Jane noticed in how they live that their cover may miss (spec step 197).
  | "risks"
  // household: who is covered by what across the household (spec step 198).
  | "household"
  // claim_worth: "is it worth claiming a $1,200 repair?" (spec step 199).
  | "claim_worth"
  // health_year: deductible progress, the out-of-pocket maximum, FSA and HSA, network and
  // bill checks (spec step 200).
  | "health_year"
  // decide: "should I get umbrella insurance?", "do I need life insurance?" and the like,
  // answered directly in a few sentences (./decisions.ts).
  | "decide"
  // business: cover for freelance, gig and side-business work (spec step 201).
  | "business";

export type InsuranceIntent = {
  kind: "insurance";
  ask: InsuranceAsk;
  // The kind of policy the person named, if any.
  policyKind: PolicyKind | null;
  // Spec step 107: what happened, by the claim guide's event key (src/config/claims.ts).
  event?: string;
  // Spec step 199: how much the damage is, when they said.
  amountCents?: number;
  // The decision asked about, when ask is "decide".
  decision?: DecisionKind;
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
  /\b(?:insurance|insured|insurer|insurers|polic(?:y|ies)|deductibles?|premiums?|(?:under|over)-?insured|(?:health|medical) plans?|benefits?\b.{0,30}\b(?:work|job|employer)|(?:work|job|employer) benefits|open enrollment|declarations? pages?|renewal notices?|safe[- ]driver)\b/;
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

// A life change the person tells Jane about (spec step 154), about insurance even without the
// word. The other events (a move, a baby, a new job) come from step 100's life events.
const MARRIED =
  /\b(?:(?:just |recently )?got married|(?:we|i)(?:'re| are| am|'m) (?:now )?married|our wedding was)\b/;
const CAR =
  /\b(?:(?:just |recently )?(?:bought|got|picked up|leased) (?:a |my |our )?(?:new |used )?car)\b/;

// Sizing, applying for or buying life cover (spec step 153), even with "need" in it.
const LIFE =
  /\b(?:how much|apply(?:ing)?|buy(?:ing)?|get(?:ting)?|sign up)\b.{0,30}\b(?:life (?:insurance|cover|policy)|term life)\b|\b(?:life (?:insurance|cover)|term life)\b.{0,30}\b(?:how much|enough|apply|buy|should i get)\b/;

// Paying less for the cover they keep (spec step 196). Only checked once the question is
// about insurance, so "discounts on Netflix" is not.
const SAVINGS =
  /\b(?:pay|spend) less\b|\bcheaper way to pay\b|\bdiscounts?\b|\b(?:raise|raising|increase|increasing|higher|bump)\b.{0,15}\bdeductibles?\b|\bbundl(?:e|ing)\b|\bpay(?:ing)? (?:it |my (?:\w+ )?(?:insurance|premium) )?(?:in full|yearly|annually|up front)\b|\b(?:lower|cut|reduce|save on)\b.{0,15}\b(?:insurance|premiums?)\b|\bsafe[- ]driver\b|\btelematics\b|\bautopay\b|\bpaperless\b/;

// Asking what their cover may be missing from how they live (spec step 197).
const RISKS =
  /\b(?:risks?|what am i missing|what(?:'s| is) not covered|am i covered for (?:uber|lyft|my (?:business|boat|dog|ring|camera))|exposed)\b/;

// Who in the household is covered by what (spec step 198).
const HOUSEHOLD =
  /\bwho(?:'s| is| are)?\b.{0,25}\b(?:covered|insured|on my (?:car |health |home )?(?:insurance|plan|policy))\b|\b(?:family|household|kids?|children|teen\w*|spouse|wife|husband|partner)\b.{0,30}\b(?:covered|insured|health plan)\b|\bfamily (?:health )?(?:plan|insurance|cover\w*)\b|\b(?:partner|spouse|wife|husband)'?s (?:employer|work|job)\b.{0,30}\b(?:plan|insurance)\b/;

// Where they are in their health plan's year (spec step 200).
const HEALTH_YEAR =
  /\b(?:fsa|flex(?:ible)? spending|use it or lose it)\b|\b(?:how much|how far|where am i|have i met|did i meet|when (?:will|do) i (?:hit|reach|meet))\b.{0,30}\b(?:deductible|out[- ]of[- ]pocket(?: max\w*)?)\b|\bdeductible\b.{0,20}\b(?:met|so far|left|remaining|progress)\b|\bout[- ]of[- ]pocket (?:max\w*|limit)\b|\bin[- ]network\b|\b(?:is|was) (?:my|this|that|the) (?:\w+ )?bill (?:right|correct|too (?:high|much))\b|\boverbill\w*|\bhealth plan\b.{0,20}\b(?:this year|so far)\b/;

// Cover for what they earn on the side (spec step 201).
const BUSINESS =
  /\b(?:side (?:gig|hustle|job|business)|freelanc\w*|self[- ]employed|gig work|business (?:insurance|liability|use|equipment)|professional liability|errors and omissions|(?:driv\w+|drive) for work|work driving|work equipment)\b/;

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

// Spec step 155: Jane filing a claim, or asking the insurer for a better renewal rate.
const FILE_FOR_ME =
  /\b(?:can|could|will|would) you (?:please )?(?:file|submit|send in)\b|\b(?:you|jane) (?:file|submit)\b.{0,20}\bclaims?\b|\bfile (?:it|the claim|my claim) with (?:my|the) (?:insurer|insurance(?: company)?)\b/;
const RENEWAL_CALL =
  /\b(?:negotiate|haggle|bargain)\b|\b(?:call|ring|phone|ask) (?:my |the )?(?:insurer|insurance(?: company)?|carrier)\b.{0,40}\b(?:better|lower|cheaper|rate|price|renewal)\b|\bbetter (?:renewal )?rate\b.{0,30}\brenew/;

// Whether a claim is worth making against paying it themselves (spec step 199).
const CLAIM_WORTH =
  /\bwhat if (?:the |it'?s )?(?:repair|damage|bill|claim)\b.{0,20}\$|\b(?:worth|should i|do i need to|is it worth)\b.{0,30}\b(?:claim|claiming|filing a claim|file a claim|make a claim|making a claim)\b|\bclaim (?:or|vs\.?|versus) (?:pay|paying|cover|out of pocket)\b|\b(?:claim|insurance)\b.{0,40}\bpay (?:it )?(?:out of pocket|myself)\b|\bpay (?:it )?(?:out of pocket|myself)\b.{0,40}\b(?:claim|insurance)\b/;

// "$1,200" or "$1.2k" in the text, in cents.
function amountIn(text: string): number | undefined {
  const m =
    /\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s?(k\b)?/i.exec(text) ??
    /\b(\d[\d,]*(?:\.\d{1,2})?)\s?(k\b)?\s?(?:dollars|bucks)\b/i.exec(text);
  if (!m) return undefined;
  const dollars = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : undefined;
}

// What happened, as a claim guide's event key.
function eventIn(text: string): string | undefined {
  if (/\b(?:stolen|theft|broke into|break-?in|burglar)\w*/.test(text)) return "theft";
  if (/\b(?:accident|crash|fender|collision|rear-?ended|hit)\b/.test(text)) return "accident";
  if (/\b(?:hail|storm|windshield|glass|flood|fire|water|tree)\b/.test(text)) return "damage";
  return undefined;
}

export function parseInsurance(text: string): InsuranceIntent | null {
  const decision = decisionKindOf(text);
  if (decision && !CLAIM_WORTH.test(text)) {
    return { kind: "insurance", ask: "decide", policyKind: kindIn(text), decision };
  }
  if (CLAIM_WORTH.test(text)) {
    return {
      kind: "insurance",
      ask: "claim_worth",
      policyKind: kindIn(text),
      amountCents: amountIn(text),
      event: eventIn(text),
    };
  }
  if (HEALTH_YEAR.test(text)) return { kind: "insurance", ask: "health_year", policyKind: null };
  if (FILE_FOR_ME.test(text)) return { kind: "insurance", ask: "file_claim", policyKind: null };
  if (RENEWAL_CALL.test(text)) {
    return { kind: "insurance", ask: "renewal_call", policyKind: kindIn(text) };
  }
  // Something happened: the claims helper, whatever words were used.
  const claim = parseClaim(text);
  if (claim) return claim;
  const policyKind = kindIn(text);
  if (
    !INSURANCE.test(text) &&
    !(COVER.test(text) && policyKind) &&
    !COVER_AMOUNT.test(text) &&
    !CARD_COVER.test(text) &&
    !LIFE.test(text) &&
    !HOUSEHOLD.test(text) &&
    !HEALTH_YEAR.test(text) &&
    !BUSINESS.test(text) &&
    !MARRIED.test(text) &&
    !CAR.test(text)
  ) {
    return null;
  }
  if (MARRIED.test(text))
    return { kind: "insurance", ask: "life_change", policyKind: null, event: "married" };
  if (CAR.test(text))
    return { kind: "insurance", ask: "life_change", policyKind: null, event: "car_bought" };
  if (LIFE.test(text)) return { kind: "insurance", ask: "life", policyKind };
  if (HEALTH_YEAR.test(text)) return { kind: "insurance", ask: "health_year", policyKind };
  if (BUSINESS.test(text)) return { kind: "insurance", ask: "business", policyKind };
  if (SAVINGS.test(text)) return { kind: "insurance", ask: "savings", policyKind };
  if (RISKS.test(text)) return { kind: "insurance", ask: "risks", policyKind };
  if (HOUSEHOLD.test(text)) return { kind: "insurance", ask: "household", policyKind };
  // Spec step 149: whether they need a kind of cover, from their numbers.
  if (policyKind && NEED.test(text)) return { kind: "insurance", ask: "need", policyKind };
  const ask = ASKS.find(([, words]) => words.test(text))?.[0] ?? "list";
  return { kind: "insurance", ask, policyKind };
}
