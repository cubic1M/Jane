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
  return Math.min(c.max, Math.round(raw));
}

// How a percentage is said: "I'm 85% sure" or, below UNSURE_BELOW, "I'm not sure (45%)".
export function sureWords(percent: number): string {
  return percent < UNSURE_BELOW ? `I'm not sure (${percent}%)` : `I'm ${percent}% sure`;
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
    ? `${evidence.matches} ${what} in ${months} of data`
    : `no ${what} in ${months} of data`;
}
