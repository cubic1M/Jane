import { parseFact } from "@/lib/jane-agent/remember";
import type { FactDraft } from "./facts";

// What the person says about themselves in the chat, understood by rules (no model call): their
// home, household, job, goals and how they like to do things. Each is remembered as said in the
// chat (source "chat"), linked to the message it came from; nothing here answers them. Pure.
// Sensitive traits are dropped later, whatever matched (./sensitive.ts).

type Draft = Omit<FactDraft, "source" | "sourceRef">;

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const tidy = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/, "")
    .trim();
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

type Rule = { pattern: RegExp; facts: (m: RegExpExecArray) => Draft[] };

const RULES: Rule[] = [
  // Home.
  {
    pattern: /\bi(?: currently)? (?:rent|am renting|'m renting)\b(?! out)/,
    facts: () => [{ key: "housing", value: "rent", label: "You rent your home" }],
  },
  {
    pattern:
      /\bi(?: just)? (?:own|bought) (?:my|a|our) (?:own )?(?:home|house|condo|apartment|place)\b/,
    facts: () => [{ key: "housing", value: "own", label: "You own your home" }],
  },
  // Household.
  {
    pattern: /\bi live (?:alone|by myself|on my own)\b/,
    facts: () => [{ key: "household", value: "single", label: "You live on your own" }],
  },
  {
    pattern: /\bi have (\d|one|two|three|four|five) (?:kids|children|sons|daughters)\b/,
    facts: (m) => {
      const n = WORD_NUMBERS[m[1]] ?? Number(m[1]);
      return [
        { key: "has_children", value: true, label: "You have children at home" },
        { key: "household", value: "family", label: `Your household: you and ${n} children` },
      ];
    },
  },
  {
    pattern:
      /\b(?:i live with|me and|my) (?:wife|husband|partner|spouse|girlfriend|boyfriend|fiancee?)\b|\bi(?:'m| am) married\b/,
    facts: () => [
      { key: "household", value: "couple", label: "You share your life with a partner" },
    ],
  },
  {
    pattern: /\bi (?:don'?t|do not) have (?:any )?(?:kids|children)\b/,
    facts: () => [{ key: "has_children", value: false, label: "You don't have children at home" }],
  },
  // Work and study.
  {
    pattern:
      /\bi(?:'m| am) (?:a |an )?(?:full[- ]time |part[- ]time )?(?:college |university |grad |graduate )?student\b/,
    facts: () => [{ key: "is_student", value: true, label: "You're a student" }],
  },
  {
    pattern: /\bi work (?:at|for) ([a-z0-9][a-z0-9&.' -]{1,38}?)(?: as\b| and\b| but\b|[.,!?]|$)/,
    facts: (m) => [{ key: "employer", value: tidy(m[1]), label: `You work at ${tidy(m[1])}` }],
  },
  {
    pattern: /\bi work (?:from home|remotely)\b/,
    facts: () => [{ key: "work_style", value: "remote", label: "You work from home" }],
  },
  {
    pattern:
      /\b(?:side (?:gig|hustle|business)|i (?:drive|deliver) for (?:uber|lyft|doordash|instacart))\b/,
    facts: () => [{ key: "side_gig", value: true, label: "You have a side gig" }],
  },
  {
    pattern: /\bi(?:'m| am) (\d{2}) (?:years old|yrs old|y\/o)\b/,
    facts: (m) => [{ key: "age", value: Number(m[1]), label: `You're ${Number(m[1])}` }],
  },
  // What they have.
  {
    pattern: /\bi (?:don'?t|do not) (?:have|own) a car\b/,
    facts: () => [{ key: "has_car", value: false, label: "You don't have a car" }],
  },
  {
    pattern: /\bi (?:have|own|drive) a (?:car|truck|suv)\b/,
    facts: () => [{ key: "has_car", value: true, label: "You have a car" }],
  },
  {
    pattern: /\bmy (?:dog|cat|puppy|kitten)\b/,
    facts: () => [{ key: "has_pet", value: true, label: "You have a pet" }],
  },
  // Goals.
  {
    pattern:
      /\b(?:i(?:'m| am) saving (?:up )?for|i want to save (?:up )?for|my goal is to (?:save for|buy)) (?:a |an |my |our |the )?([a-z0-9' -]{2,40}?)(?: by\b| in\b| next\b| this\b|[.,!?]|$)/,
    facts: (m) => [
      { key: `goal:${slug(m[1])}`, value: tidy(m[1]), label: `You're saving for ${tidy(m[1])}` },
    ],
  },
  {
    pattern:
      /\b(?:i want to|i'm trying to|i am trying to|my goal is to) (pay off|get out of|pay down) (?:my |the |our )?([a-z0-9' -]{2,40}?)(?: by\b| in\b| this\b|[.,!?]|$)/,
    facts: (m) => [
      {
        key: `goal:${slug(`${m[1]} ${m[2]}`)}`,
        value: tidy(`${m[1]} ${m[2]}`),
        label: `You want to ${tidy(`${m[1]} ${m[2]}`)}`,
      },
    ],
  },
  // How they like to do things.
  {
    pattern:
      /\bi(?:'d| would)? (?:rather|prefer to) (?:do|handle|sort) (?:it|this|that|things|them)(?: all)? myself\b|\bi(?:'ll| will) do it myself\b|\bdiy\b/,
    facts: () => [
      { key: "prefers_diy", value: true, label: "You'd rather do things yourself, with the steps" },
    ],
  },
];

// The facts a chat message states, each once.
export function factsFromChat(text: string): Draft[] {
  // Matched case-blind, so a name keeps its capitals ("Blue Bottle Coffee").
  const typed = text.replace(/[’‘]/g, "'");
  const said = typed.toLowerCase();
  const found = new Map<string, Draft>();
  // Payday, as "Remember this" reads it (src/lib/jane-agent/remember.ts), one sentence at a
  // time. What they "need" isn't taken from there: "I need help with my budget" isn't a keep.
  for (const sentence of said.split(/(?<=[.!?])\s+/)) {
    const pref = parseFact(tidy(sentence));
    if (!pref || pref.kind !== "fact") continue;
    if (pref.key === "payday" && Array.isArray(pref.value.days)) {
      found.set("payday", { key: "payday", value: pref.value.days.join(","), label: pref.label });
    }
  }
  for (const rule of RULES) {
    const m = new RegExp(rule.pattern.source, "i").exec(typed);
    if (!m) continue;
    for (const fact of rule.facts(m)) if (!found.has(fact.key)) found.set(fact.key, fact);
  }
  return [...found.values()];
}
