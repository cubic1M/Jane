import type { PolicyKind } from "@/config/insurance";

// Questions about insurance, understood by rules (spec Phase X). Pure: the normalized text
// (src/lib/jane-agent/intents.ts normalize) in, an insurance intent or null out.

// cover: what a policy covers and its limits. renew: when it renews. cost: what it costs.
// deductible: its deductible. gaps: what looks missing. list: every policy on file.
// quotes: compare prices from the insurance partner (spec step 103). switch: how a switch
// Jane is doing is going (spec step 105).
export type InsuranceAsk =
  "cover" | "renew" | "cost" | "deductible" | "gaps" | "list" | "quotes" | "switch";

export type InsuranceIntent = {
  kind: "insurance";
  ask: InsuranceAsk;
  // The kind of policy the person named, if any.
  policyKind: PolicyKind | null;
};

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
  /\b(?:insurance|insured|insurer|insurers|polic(?:y|ies)|deductibles?|premiums?)\b/;
const COVER = /\b(?:cover|covers|covered|coverage)\b/;

const ASKS: readonly [InsuranceAsk, RegExp][] = [
  [
    "switch",
    /\bswitch(?:ed|ing)?\b.*\b(?:going|status|done|yet|happen\w*|progress|over)\b|\bdid you (?:switch|change)\b|\bhow'?s (?:my|the) switch\b|\bis my (?:new )?(?:insurance|policy) (?:active|in place|done)\b/,
  ],
  [
    "quotes",
    /\b(?:quotes?|compare|comparing|shop|shopping|reshop|cheaper|better (?:price|deal|rate)|lower price|best price|find me|switch)\b/,
  ],
  ["renew", /\b(?:renew|renews|renewal|renewing|expire|expires|expiry|run out|runs out)\b/],
  ["deductible", /\bdeductibles?\b/],
  [
    "gaps",
    /\b(?:missing|gaps?|enough|underinsured|under-insured|over-insured|need any|do i need|am i covered enough|anything i need)\b/,
  ],
  ["cost", /\b(?:how much|cost|costs|paying|price|premiums?|a month|a year)\b/],
  ["cover", /\b(?:cover|covers|covered|coverage|limits?|include|includes|what does)\b/],
];

export function kindIn(text: string): PolicyKind | null {
  return KIND_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
}

export function parseInsurance(text: string): InsuranceIntent | null {
  const policyKind = kindIn(text);
  if (!INSURANCE.test(text) && !(COVER.test(text) && policyKind)) return null;
  const ask = ASKS.find(([, words]) => words.test(text))?.[0] ?? "list";
  return { kind: "insurance", ask, policyKind };
}
