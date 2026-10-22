import { COMPLEXITY_PHRASES, COMPLEX_MIN_FACTORS, type ComplexityKey } from "@/config/accountant";
import { listOf } from "@/planning/tax-profile";

// Working with an accountant (spec step 222). Pure: when a situation is the kind people
// usually bring a tax professional to (facts about the return, nothing more), and what a
// link's state is.

export type ComplexityFacts = Partial<Record<ComplexityKey, boolean>>;

const ORDER = Object.keys(COMPLEXITY_PHRASES) as ComplexityKey[];

export function complexity(facts: ComplexityFacts): {
  factors: ComplexityKey[];
  complex: boolean;
  text: string | null;
} {
  const factors = ORDER.filter((k) => facts[k]);
  const complex = factors.length >= COMPLEX_MIN_FACTORS;
  return {
    factors,
    complex,
    text: complex
      ? `Your taxes include ${listOf(factors.map((k) => COMPLEXITY_PHRASES[k]))}. People with that mix usually work with an accountant or tax preparer.`
      : null,
  };
}

export type LinkState = "active" | "expired" | "revoked";

export function linkState(link: { expiresAt: Date; revokedAt: Date | null }, now: Date): LinkState {
  if (link.revokedAt) return "revoked";
  return link.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
}

export type Question = { key: string; text: string };
