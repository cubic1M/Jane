import { SCENARIOS, SCENARIO_WORDS, type Scenario } from "@/config/what-if";

// What if (spec step 203), typed: "what if I lose my job for 4 months?", "what if we have
// a baby?". Pure. Only a question that starts "what if", "what would happen if" or
// "suppose" counts, so "I lost my job" isn't taken for a thought experiment.

export type WhatIfIntent = { kind: "what_if"; scenario: Scenario; months: number | null };

const ASKS =
  /\bwhat (?:if|would happen if|happens if|about if)\b|\bsuppose\b|\bimagine\b|\bhow would .* (?:change|affect)\b/;
const MONTHS = /\bfor (?:about |around )?(\d{1,2}) months?\b/;
const YEAR = /\bfor (?:a|one) year\b/;

export function parseWhatIf(text: string): WhatIfIntent | null {
  if (!ASKS.test(text)) return null;
  const scenario = SCENARIOS.find((s) => SCENARIO_WORDS[s].test(text));
  if (!scenario) return null;
  const months = MONTHS.exec(text) ? Number(MONTHS.exec(text)![1]) : YEAR.test(text) ? 12 : null;
  return { kind: "what_if", scenario, months };
}
