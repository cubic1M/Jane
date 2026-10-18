// Every piece of Claude-written text passes through checkGuardrails before anyone sees it.
// Anything that fails is replaced with fixed template text, so these checks lean strict:
// a false alarm only costs a plainer explanation.

export type GuardrailIssue =
  "investment_advice" | "tax_or_legal_advice" | "unsupported_dollar_figure" | "guaranteed_outcome";

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
  /\bliab(le|ility)\b/i,
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

export function dollarFigures(text: string): Figure[] {
  const figures: Figure[] = [];
  for (const pattern of [DOLLAR_SIGN, DOLLAR_WORD]) {
    for (const match of text.matchAll(pattern)) {
      const number = match[1].replaceAll(",", "");
      figures.push({
        cents: Math.round(Number(number) * 100),
        wholeDollars: !number.includes("."),
        scaled: Boolean(match[2]),
      });
    }
  }
  return figures;
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

export function checkGuardrails(text: string, allowedCents: readonly number[]): GuardrailResult {
  const issues: GuardrailIssue[] = [];
  if (INVESTMENT.some((p) => p.test(text))) issues.push("investment_advice");
  if (TAX_OR_LEGAL.some((p) => p.test(text))) issues.push("tax_or_legal_advice");
  if (dollarFigures(text).some((f) => !supported(f, allowedCents))) {
    issues.push("unsupported_dollar_figure");
  }
  if (GUARANTEE.some((p) => p.test(text))) issues.push("guaranteed_outcome");
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
