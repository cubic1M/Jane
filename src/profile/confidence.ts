import {
  THIN_DATA_MAX_PERCENT,
  THIN_DATA_MAX_PER_MONTH,
  THIN_DATA_MONTHS,
} from "@/config/detection";
import { CONFIDENCE, UNSURE_BELOW } from "@/config/profile";

export type Source = "seen" | "told" | "guessed";

// How sure Jane is, as a whole percentage, from the evidence: how many months of data and
// how many clean matches. The same evidence always gives the same number (spec step 254).
export function confidenceOf(
  source: Source,
  evidence: { months: number; matches: number },
): number {
  if (source === "told") return CONFIDENCE.told;
  const c = CONFIDENCE[source];
  const raw =
    c.base +
    Math.max(0, evidence.months) * c.perMonth +
    Math.min(Math.max(0, evidence.matches), c.matchCap) * c.perMatch;
  // Thin data: a few months of history can't make Jane very sure, however many matches it has
  // (messy-bank QA: three months read as 62% sure).
  const thin =
    evidence.months < THIN_DATA_MONTHS
      ? THIN_DATA_MAX_PERCENT + Math.max(0, evidence.months) * THIN_DATA_MAX_PER_MONTH
      : Infinity;
  return Math.min(c.max, thin, Math.round(raw));
}

// How a percentage is said: "I'm 85% sure" or, below UNSURE_BELOW, "I'm not sure (45%)".
export function sureWords(percent: number): string {
  return percent < UNSURE_BELOW ? `I'm not sure (${percent}%)` : `I'm ${percent}% sure`;
}

// "1 cards linked" reads wrong: with one match, the first plural word becomes singular
// ("1 card linked", "1 interest charge"). Words ending ss, us, is, as or os are left alone.
export function counted(n: number, what: string): string {
  if (n !== 1) return `${n} ${what}`;
  const words = what.split(" ");
  const i = words.findIndex((w) => /[^s]s$/.test(w) && !/(us|is|as|os)$/.test(w));
  if (i >= 0) words[i] = words[i].slice(0, -1);
  return `1 ${words.join(" ")}`;
}

// The sentence shown next to a percentage: "based on 12 months of charges".
export function evidenceText(
  source: Source,
  evidence: { months: number; matches: number },
  what: string,
): string {
  if (source === "told") return "you told me";
  const months = `${evidence.months} month${evidence.months === 1 ? "" : "s"}`;
  return evidence.matches > 0
    ? `${counted(evidence.matches, what)} in ${months} of data`
    : `no ${what} in ${months} of data`;
}
