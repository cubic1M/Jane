// What Jane never remembers about a person (founder, 2026-10-29): anything about their health,
// religion, politics, sexual orientation, ethnicity or immigration status, even when their
// transactions or their words hint at it. Every fact passes through here before it's stored
// (src/lib/memory/facts.ts), whatever its source. When in doubt it's left out: a goal like
// "pay off the hospital bill" isn't kept either.

export type SensitiveCategory =
  "health" | "religion" | "politics" | "sexual_orientation" | "ethnicity" | "immigration";

const WORDS: Record<SensitiveCategory, RegExp> = {
  health:
    /\b(?:health\w*|medical|medicine|medication\w*|medicare|medicaid|doctors?|physician|hospital\w*|clinic\w*|therap\w+|psychiatr\w*|psycholog\w*|counsel+ing|pharmac\w+|prescription\w*|diagnos\w*|illness\w*|sick\w*|disease\w*|cancer|chemo\w*|diabet\w*|hiv|aids|pregnan\w*|ivf|fertility|abortion|rehab\w*|addiction|disab\w+|mental|depress\w*|anxiety|surgery|surgical|dialysis|insulin|weight loss|ozempic|wegovy|planned parenthood|baby|babies|newborn|maternity)\b/i,
  religion:
    /\b(?:religio\w*|church\w*|mosque\w*|synagogue\w*|temple|tith\w+|zakat|parish\w*|ministr\w+|christian\w*|catholic\w*|protestant|mormon|lds|muslim\w*|islam\w*|jewish|judaism|hindu\w*|buddhis\w*|sikh\w*|atheis\w*|bible|quran|koran|torah|prayer\w*|pastor|priest|rabbi|imam)\b/i,
  politics:
    /\b(?:politic\w*|democrat\w*|republican\w*|gop|campaign contribution\w*|campaign donation\w*|actblue|winred|election\w*|candidate\w*|(?:liberal|conservative|progressive) (?:party|parties|candidates?|causes?)|maga|super ?pac|pac donation\w*|libertarian\w*|socialis\w*)\b/i,
  sexual_orientation:
    /\b(?:gay|lesbian\w*|bisexual\w*|queer|lgbt\w*|transgender\w*|nonbinary|non-binary|homosexual\w*|heterosexual\w*|sexual orientation|grindr)\b/i,
  ethnicity:
    /\b(?:ethnic\w*|racial\w*|race|hispanic\w*|latin[oax]s?|african[- ]american\w*|asian[- ]american\w*|native american\w*|indigenous|caucasian\w*|i(?:'m| am) (?:black|white|asian|arab|mixed))\b/i,
  immigration:
    /\b(?:immigra\w*|emigra\w*|green card|uscis|citizenship|naturali[sz]\w*|asylum|refugee\w*|deport\w*|undocumented|daca|h-?1b|(?:student|work|tourist|immigrant|travel|spouse|fiancee?) visas?|visa (?:status|application|renewal|fee|sponsorship)|work permit|ead card|i-\d{3}|remittance\w*)\b/i,
};

// Profile facts (src/profile/facts.ts) that are such an inference whatever their value: worked
// out from medical spending, baby goods or Medicare cover.
export const SENSITIVE_KEYS = new Set([
  "health_costs",
  "new_baby",
  "insurance_medigap",
  "hardship_reason",
  "marketplace_aptc_monthly",
  "marketplace_benchmark_monthly",
]);

// The first sensitive category the text touches, or null.
export function sensitiveCategory(text: string): SensitiveCategory | null {
  // Keys use underscores and colons ("goal:church_trip"): read them as words.
  const words = text.replace(/[_:]+/g, " ");
  for (const [category, pattern] of Object.entries(WORDS) as [SensitiveCategory, RegExp][]) {
    if (pattern.test(words)) return category;
  }
  return null;
}

// Whether a fact must not be stored: a sensitive key, or a key, label or value that touches a
// sensitive category.
export function isSensitiveFact(fact: { key: string; label: string; value: unknown }): boolean {
  if (SENSITIVE_KEYS.has(fact.key)) return true;
  const value = typeof fact.value === "string" ? fact.value : "";
  return sensitiveCategory(`${fact.key} ${fact.label} ${value}`) !== null;
}

// Whether a profile fact (src/profile/facts.ts) stays out of what Claude is sent: one of the
// inferences above whatever its value, or a value in the person's own words that touches a
// sensitive category (an employer that is a church). The labels are the app's own words, so not
// those: "You pay for health insurance yourself" is about insurance.
export function isSensitiveProfileFact(key: string, value: unknown): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  return typeof value === "string" && sensitiveCategory(value) !== null;
}

// Whether something the person told Jane (a preference, src/lib/jane-agent/preferences.ts) stays
// out of what Claude is sent. Stored before the fact filter runs, as the person's own wish, so it
// is checked here instead: "never suggest cutting my therapy" names their health.
export function isSensitivePreference(p: { key: string; label: string; value: unknown }): boolean {
  return isSensitiveFact({ key: p.key, label: p.label, value: JSON.stringify(p.value ?? "") });
}
