import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import { formatCents } from "@/lib/money";

// A policy's premium as the found-policy card says it ("$112.40 a month") and as its item on
// Insurance says it with the year it comes to ("$112.40 a month, $1,348.80 a year"): one wording for
// both (debug 2, 11-22: the card said $112.40 a month and the page only "$1.3k/yr"). Null when the
// premium or how often it's paid isn't known. Pure.
type Premium = { premiumCents: number | null; premiumFrequency: PremiumFrequency | null };

export function premiumWords({ premiumCents, premiumFrequency }: Premium): string | null {
  if (premiumCents === null || !premiumFrequency) return null;
  return `${formatCents(premiumCents)} ${PREMIUM_FREQUENCIES[premiumFrequency].label}`;
}

export function premiumWithYear(p: Premium): string | null {
  const words = premiumWords(p);
  if (!words || p.premiumFrequency === "yearly") return words;
  return `${words}, ${formatCents(p.premiumCents! * PREMIUM_FREQUENCIES[p.premiumFrequency!].perYear)} a year`;
}
