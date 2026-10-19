import type { FindingType } from "@/generated/prisma/client";

// Every piece of Claude-written text passes through checkGuardrails before anyone sees it.
// Anything that fails is replaced with fixed template text, so these checks lean strict:
// a false alarm only costs a plainer explanation.

export type GuardrailIssue =
  | "investment_advice"
  | "tax_or_legal_advice"
  | "unsupported_dollar_figure"
  | "guaranteed_outcome"
  | "missing_required_wording";

export type GuardrailResult = { ok: true } | { ok: false; issues: GuardrailIssue[] };

// (a) Specific securities, investments or crypto. High-yield savings accounts and CDs are
// bank deposits, not investments, so they're allowed.
const INVESTMENT = [
  /\binvest/i,
  /\bstocks?\b/i,
  /\bshares\b/i,
  /\bequit(y|ies)\b/i,
  /\bbonds?\b/i,
  /\bsecurities\b/i,
  /\betfs?\b/i,
  /\b(index|mutual|money[- ]market|hedge) funds?\b/i,
  /\btreasur(y|ies)\b/i,
  /\bt-bills?\b/i,
  /\bbrokerage\b/i,
  /\bportfolio/i,
  /\bdividends?\b/i,
  /\bcrypto/i,
  /\b(bitcoin|ethereum|btc|eth|solana|dogecoin|stablecoins?)\b/i,
  /\b(nyse|nasdaq|s&p ?500|dow jones|ticker)\b/i,
  /\b401\(?k\)?/i,
  /\b(roth|ira)\b/i,
  /\bannuit(y|ies)\b/i,
  // What to buy, sell or hold, and how investments did (spec step 66: balances only).
  /\b(buy|buying|sell|selling|hold|holding|dump|trim)\b[^.!?]{0,40}\b(positions?|holdings?|funds?|shares?|stocks?|assets?)\b/i,
  /\brebalanc/i,
  /\b(asset )?allocation\b/i,
  /\b(outperform\w*|underperform\w*|beat the market|market timing|capital gains?)\b/i,
];

// (b) Tax or legal advice.
const TAX_OR_LEGAL = [
  /\btax(es|ed|able)?\b/i,
  // Tax deductions. An insurance deductible is fine, so "deductible" alone is allowed.
  /\bdeductions?\b/i,
  /\bwrite[- ]off\b/i,
  /\birs\b/i,
  /\blegal(ly)?\b/i,
  /\b(lawyer|attorney|lawsuit|litigation|court)s?\b/i,
  /\bsue\b/i,
  // Liability cover on an insurance policy is a kind of cover, not legal advice.
  /(?<!(?:injury|damage|personal) )\bliab(le|ility)\b(?! (?:cover|coverage|insurance|limits?|only)\b)(?!, per\b)/i,
];

// (d) Promised outcomes. Savings are estimates: "could save about", never "will save".
const GUARANTEE = [
  /\bguarantee/i,
  /\bpromise/i,
  /\b(definitely|certainly|surely)\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  /\b100 ?%/,
  /\b(will|you'll|you will) (save|get|recover|receive|earn)\b/i,
];

// "$1,234.56", "$15", "$ 15.5", plus "15 dollars". A k/m suffix makes the figure unreadable
// for matching, so it counts as unsupported.
const DOLLAR_SIGN =
  /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s?(?:k|m|bn|thousand|million|billion)\b)?/gi;
const DOLLAR_WORD = /\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:dollars|bucks|usd)\b/gi;

type Figure = { cents: number; wholeDollars: boolean; scaled: boolean };

function figureOf(match: RegExpMatchArray): Figure {
  const number = match[1].replaceAll(",", "");
  return {
    cents: Math.round(Number(number) * 100),
    wholeDollars: !number.includes("."),
    scaled: Boolean(match[2]),
  };
}

export function dollarFigures(text: string): Figure[] {
  return [DOLLAR_SIGN, DOLLAR_WORD].flatMap((pattern) => [...text.matchAll(pattern)].map(figureOf));
}

// (c) Every dollar figure must be one we gave Claude. A whole-dollar figure may round an
// amount ("$186" for $185.88).
function supported(figure: Figure, allowedCents: readonly number[]): boolean {
  if (figure.scaled) return false;
  return allowedCents.some((allowed) => {
    const amount = Math.abs(allowed);
    return figure.wholeDollars ? Math.abs(amount - figure.cents) < 100 : amount === figure.cents;
  });
}

// Wording some cards must use. A bill's price is compared with a typical price, never
// called too high as a fact.
export const REQUIRED_WORDING: Partial<Record<FindingType, RegExp>> = {
  bill_negotiation: /\btypical price\b/i,
};

// The dollar figures in text that nothing we gave Claude supports, as written.
export function unsupportedFigures(text: string, allowedCents: readonly number[]): string[] {
  const figures: string[] = [];
  for (const pattern of [DOLLAR_SIGN, DOLLAR_WORD]) {
    for (const match of text.matchAll(pattern)) {
      if (!supported(figureOf(match), allowedCents)) figures.push(match[0].trim());
    }
  }
  return figures;
}

export function checkGuardrails(
  text: string,
  allowedCents: readonly number[],
  findingType?: FindingType,
): GuardrailResult {
  const issues: GuardrailIssue[] = [];
  const required = findingType && REQUIRED_WORDING[findingType];
  if (required && !required.test(text)) issues.push("missing_required_wording");
  if (INVESTMENT.some((p) => p.test(text))) issues.push("investment_advice");
  if (TAX_OR_LEGAL.some((p) => p.test(text))) issues.push("tax_or_legal_advice");
  if (dollarFigures(text).some((f) => !supported(f, allowedCents))) {
    issues.push("unsupported_dollar_figure");
  }
  if (GUARANTEE.some((p) => p.test(text))) issues.push("guaranteed_outcome");
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// (e) Recommending one choice over another. The debt planner is education: it shows the
// math for each order of paying cards down and leaves the choice to the person.
const RECOMMENDATION = [
  /\byou should\b/i,
  /\b(we|i) (recommend|suggest|advise)\b/i,
  // "Not a recommendation" is how the planner says it doesn't recommend, so it's allowed.
  /\brecommended\b/i,
  /\b(our|my) recommendation\b/i,
  /\b(best|better|smartest|right|wisest) (choice|option|strategy|plan|way|approach)\b/i,
  /\bgo with\b/i,
  /\bpick (the )?(avalanche|snowball)\b/i,
];

export function recommendsAChoice(text: string): boolean {
  return RECOMMENDATION.some((pattern) => pattern.test(text));
}
