import type { Fact, Profile } from "@/profile/build";
import type { FactKey } from "@/profile/facts";

// "Give me a summary of who I am" (founder, 2026-10-26): a short, warm paragraph about the
// person, built only from the profile's facts, each said as sure as Jane is of it: plainly when
// it is sure, "probably" when it is fairly sure, "I'm not sure, but you may" when it is a guess,
// and "you told me" for what they said. Every claim names the fact it rests on (so a test can
// trace it). Nothing is said about a fact Jane doesn't hold, nothing about health beyond what it
// costs, and no figures. Pure.

export type Level = "told" | "sure" | "probably" | "guess";
export type Claim = { fact: FactKey; text: string; level: Level; percent: number };
export type WhoAmI = { body: string; claims: Claim[] };

// At or above this a fact is said plainly; from GUESS_BELOW up, as "probably"; below, as a guess.
const PLAIN_FROM = 75;
const GUESS_BELOW = 50;
// A guess this weak (work from home, read from nothing but the absence of a commute) is left out.
const SAY_FROM = 40;

const levelOf = (fact: Fact): Level =>
  fact.source === "told"
    ? "told"
    : fact.confidence >= PLAIN_FROM
      ? "sure"
      : fact.confidence >= GUESS_BELOW
        ? "probably"
        : "guess";
const isTrue = (f: Fact) => f.value === true;

// "rent your home, are paid a salary and go to a gym": the bare clauses, joined.
const joined = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

export function whoAmI(profile: Profile): WhoAmI {
  const f = profile.facts;
  const claims: Claim[] = [];
  // A clause (bare: "have a pet", "are retired") about a fact, in the order it is said.
  const say = (key: FactKey, clause: string) => {
    const fact = f[key];
    if (fact.source !== "told" && fact.confidence < SAY_FROM) return;
    const level = levelOf(fact);
    // A guess reads "you may be retired", not "you may are retired".
    const text = level === "guess" && clause.startsWith("are ") ? `be ${clause.slice(4)}` : clause;
    claims.push({ fact: key, text, level, percent: fact.confidence });
  };

  // --- Home and household -----------------------------------------------------------------
  if (isTrue(f.has_children)) {
    say("has_children", "have kids at home");
    if (isTrue(f.new_baby)) say("new_baby", "have a new baby");
  } else if (f.household.value === "couple") {
    say("household", "share your household with a partner");
  } else if (f.household.value === "single" && f.household.confidence >= GUESS_BELOW) {
    say("household", "live on your own");
  }
  if (f.housing.value === "own") say("housing", "own your home");
  else if (f.housing.value === "rent") say("housing", "rent your home");
  if (isTrue(f.moved_recently)) say("moved_recently", "moved recently");

  // --- Work and pay -----------------------------------------------------------------------
  if (f.life_stage.value === "retired") say("life_stage", "are retired");
  else if (f.income_pattern.value === "salary") say("income_pattern", "are paid a salary");
  else if (f.income_pattern.value === "uneven")
    say("income_pattern", "are paid unevenly, like a freelancer");
  else if (f.income_pattern.value === "business")
    say("income_pattern", "get paid through a business");
  else if (f.income_pattern.value === "pension")
    say("income_pattern", "live on a pension or Social Security");
  if (f.work_style.value === "commuter") say("work_style", "commute to work");
  else if (f.work_style.value === "remote") say("work_style", "work from home");
  if (isTrue(f.side_gig)) say("side_gig", "earn something on the side");
  if (isTrue(f.is_student)) say("is_student", "are a student");

  // --- Day to day -------------------------------------------------------------------------
  if (isTrue(f.has_pet)) say("has_pet", "have a pet");
  if (isTrue(f.has_car)) say("has_car", "have a car");
  if (isTrue(f.goes_to_gym)) say("goes_to_gym", "go to a gym or fitness class");
  if (isTrue(f.travels_often)) say("travels_often", "travel often");
  if (f.eating_style.value === "cooks") say("eating_style", "mostly cook at home");
  else if (f.eating_style.value === "eats_out") say("eating_style", "eat out a lot");
  if (isTrue(f.health_costs)) say("health_costs", "spend a real share on health care");

  if (claims.length === 0) {
    return {
      body: "I don't know much about you yet. Once your accounts are linked I'll learn from what I see in your payments, and you can always tell me more.",
      claims,
    };
  }
  // One sentence for what Jane is sure of, one for what it thinks, one for what it is guessing,
  // one for what they told it, so each is said at its own strength.
  const group = (level: Level) => claims.filter((c) => c.level === level).map((c) => c.text);
  const sentences = [
    group("sure").length > 0 && `You ${joined(group("sure"))}.`,
    group("probably").length > 0 && `You probably ${joined(group("probably"))}.`,
    group("guess").length > 0 && `I'm not sure, but you may ${joined(group("guess"))}.`,
    group("told").length > 0 && `You told me you ${joined(group("told"))}.`,
  ].filter((s): s is string => typeof s === "string");
  return {
    body: `Here's the picture I have of you, from your payments. ${sentences.join(" ")} If I've got any of it wrong, correct it on your profile and I'll use your answer everywhere.`,
    claims,
  };
}
