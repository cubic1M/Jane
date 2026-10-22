import { APPROVED_DEBT_SENTENCES } from "@/config/debt-trouble";
import { APPROVED_FAMILY_SENTENCES } from "@/config/family-file";
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

// (b) Tax or legal advice. Demo advice (below) allows the tax part, never the legal part.
const TAX = [
  /\btax(es|ed|able)?\b/i,
  // Tax deductions. An insurance deductible is fine, so "deductible" alone is allowed, and
  // so is what comes out of a paycheck ("payroll deductions", spec step 93).
  /(?<!(?:payroll|paycheck|pay) )\bdeductions?\b(?! (?:from|on|in) (?:your|my|the|their) (?:pay|paycheck|paychecks|wages)\b)/i,
  /\bwrite[- ]off\b/i,
  /\birs\b/i,
  // Also a loan's liability and being liable, which demo advice may talk about. Liability
  // cover on an insurance policy is a kind of cover, so it's allowed (spec step 102).
  /(?<!(?:injury|damage|personal) )\bliab(le|ility)\b(?! (?:cover|coverage|insurance|limits?|only)\b)(?!, per\b)/i,
];
// Legal ADVICE, meaning directives and claims about the law: suing, going to court, a case
// the person could win, what they are legally entitled to. Mentioning a lawyer or an attorney,
// or the word "legal" on its own ("legal deductions", "the legal side"), is the opposite of
// advice, so it is not here (spec step 93 narrowed this too: a food court is a place to eat).
const LEGAL = [
  /\bsue (?:them|him|her|you|it|the|a|an|for|over)\b|\bsu(?:ed|ing)\b/i,
  /\blegal (?:grounds|action|claim|case|recourse|remedy|remedies)\b/i,
  /\blegally (?:required|obligated|bound|entitled|allowed to|can)\b/i,
  /\b(?:take|took|taken|drag|dragged) (?:you |them |him |her |it |the \w+ )?to (?:small claims )?court\b/i,
  /\bfile (?:for (?:probate|divorce|custody)|(?:in|with) (?:the |a )?court)\b/i,
  /\b(?:don(?:'|’)?t|do not|doesn(?:'|’)?t|no) need (?:a |an )?(?:lawyer|attorney)\b/i,
  /\b(?:file|filed|filing|bring|start|pursue|threaten)\w* (?:a |the )?(?:lawsuit|litigation|suit)\b/i,
  /\b(?:win|lose) (?:the |a |your )?(?:case|lawsuit|suit)\b/i,
  // Spec step 229: what to do about bankruptcy or settlement is legal advice. The facts
  // Jane gives about them are fixed sentences (src/config/debt-trouble.ts) that pass below.
  /\bbankruptcy\b/i,
  /\bchapter (?:7|11|13)\b/i,
  /\bdebt settlement\b/i,
  // Only a debt: "stop paying overdraft fees" is the opposite of legal trouble.
  /\b(?:stop|quit) paying (?:on |off )?(?:my |your |the |their )?(?:cards?|credit cards?|loans?|debts?|creditors?|collectors?|minimums?|mortgage|bills)\b/i,
  // Spec step 237: wills, trusts and what to do with an estate are legal advice. The facts
  // Jane gives are fixed sentences (src/config/family-file.ts) that pass below.
  /\b(?:last )?will and testament\b/i,
  /\b(?:revocable|irrevocable|living|testamentary|special[- ]needs|family)\s+trusts?\b/i,
  /\b(?:write|draft|make|update|change|sign|create|set up|file)\s+(?:a|an|your|my|the)\s+(?:new\s+)?(?:will|trust)\b/i,
  /\b(?:put|place|move|transfer)\b[^.!?]{0,60}\b(?:in|into)\s+(?:a|your|the)\s+trust\b/i,
  /\b(?:a|your|the)\s+(?:will|trust)\b[^.!?]{0,40}\b(?:better|best|instead|rather)\b/i,
  /\bprobate\b/i,
  /\bpower of attorney\b/i,
  /\bestate (?:plan|planning|tax)\b/i,
  /\bexecutor\b/i,
];

// Saying Jane can't help with something legal, or pointing to a lawyer for it, is not legal
// advice: the sentence that does only that is taken out before checking. Only a sentence
// that says "can't" / "not able" or sends the person to a professional, and gives no
// instruction of its own ("you should sue").
const REFERRAL = [
  /\b(?:i|jane) (?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|am not able|am unable|(?:'|’)m not able)\b/i,
  /\bnot something (?:i|jane)\b/i,
  /\b(?:talk|speak|check|consult|ask|work|go|reach out|turn) (?:to|with) (?:a|an|your|the)\b[^.!?]{0,40}\b(?:lawyer|attorney|professional|expert|advisor|adviser)\b/i,
  /\b(?:a|an|your) (?:\w+ )?(?:lawyer|attorney) (?:can|could|is the right|would)\b/i,
];
// Naming who handles the legal part ("an estate attorney or the bank's bereavement team handles
// that") is a pointer, not advice, in both profiles.
const HANDLERS = [
  /\b(?:estate (?:attorney|lawyer)|probate (?:attorney|lawyer)|attorney|lawyer|bereavement team|estate team|executor)s?\b[^.!?]{0,60}\b(?:handles?|can help|can walk you|will walk you|knows how|is the right|are the right|can explain)\b/i,
];
const ADVICE_OF_ITS_OWN = /\b(?:you should|you need to|you must|file for|sue)\b/i;

// "Legal deductions", "legal ways": the word as an adjective for what is allowed, not advice.
const BENIGN_LEGAL =
  /\blegal(?:ly)? (?:deductions?|credits?|ways?|options?|methods?|strateg\w+|tax breaks?|alternatives?|route)\b/gi;

// Sentences in which Jane refuses ("I can't help hide income from the IRS") or, in demo
// advice, points to a lawyer, are not advice about the thing they name: they are taken out
// before checking. `refusalsOnly` (the standard profile) takes out only her own "I can't".
function withoutReferrals(text: string, refusalsOnly = false): string {
  const patterns = [...(refusalsOnly ? REFERRAL.slice(0, 2) : REFERRAL), ...HANDLERS];
  const sensitive = [...LEGAL, ...TAX];
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) =>
        !(
          sensitive.some((p) => p.test(sentence)) &&
          patterns.some((p) => p.test(sentence)) &&
          !ADVICE_OF_ITS_OWN.test(sentence)
        ),
    )
    .join(" ");
}

// Spec step 229: the reviewed sentences about settlement, bankruptcy, forgiven-debt tax and
// where to take legal questions are taken out before checking. Only these exact sentences:
// any other line about them, or a changed word, is still checked in full.
function withoutApprovedSentences(text: string): string {
  return [...APPROVED_DEBT_SENTENCES, ...APPROVED_FAMILY_SENTENCES].reduce(
    (t, sentence) => t.split(sentence).join(" "),
    text,
  );
}

// "No guarantee", "can't promise", "isn't guaranteed": saying there is no promise isn't one.
const NEGATED_PROMISE =
  /\b(?:not|never|no|isn(?:'|’)?t|aren(?:'|’)?t|doesn(?:'|’)?t|don(?:'|’)?t|can(?:'|’)?t|cannot|won(?:'|’)?t|without)\s+(?:\w+\s+)?(?:a\s+|any\s+)?(?:guarantee\w*|promise\w*|definitely|certain\w*)\b/gi;

// (d) Promised outcomes. Savings are estimates: "could save about", never "will save".
const GUARANTEE = [
  /\bguarantee/i,
  /\bpromise/i,
  /\b(definitely|certainly|surely)\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  /\b100 ?%/,
  // Getting paid on payday is a date, not a promise (spec step 93).
  /\b(will|you'll|you will) (save|get|recover|receive|earn)\b(?! paid\b)/i,
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

// Which rules apply (spec step 98). "standard" is everyone with real data. "demo_advice" is
// for people in demo advice mode (src/lib/advice-mode.ts) only: recommendations on
// investments, taxes, insurance and loans may pass, while unsupported figures, promised
// outcomes and legal advice stay blocked. Text it passes carries DEMO_ADVICE_LABEL.
export type GuardrailProfile = "standard" | "demo_advice";

type Scan = { issues: GuardrailIssue[]; matched: string[] };

function scan(
  text: string,
  allowedCents: readonly number[],
  findingType: FindingType | undefined,
  profile: GuardrailProfile,
): Scan {
  const issues: GuardrailIssue[] = [];
  const matched: string[] = [];
  const advice = profile === "demo_advice";
  const original = text;
  text = withoutApprovedSentences(text);
  text = text.replace(BENIGN_LEGAL, "allowed");
  // A refusal isn't advice; in demo advice a pointer to a lawyer isn't either.
  text = withoutReferrals(text, !advice);
  const hits = (patterns: readonly RegExp[], label: string) => {
    const found = patterns.filter((p) => p.test(text));
    matched.push(...found.map((p) => `${label}:${p.source.slice(0, 60)}`));
    return found.length > 0;
  };
  const required = findingType && REQUIRED_WORDING[findingType];
  if (required && !required.test(original)) issues.push("missing_required_wording");
  if (!advice && hits(INVESTMENT, "investment")) issues.push("investment_advice");
  const tax = !advice && hits(TAX, "tax");
  const legal = hits(LEGAL, "legal");
  if (tax || legal) issues.push("tax_or_legal_advice");
  if (dollarFigures(text).some((f) => !supported(f, allowedCents))) {
    issues.push("unsupported_dollar_figure");
  }
  const unnegated = text.replace(NEGATED_PROMISE, " ");
  const promised = GUARANTEE.filter((p) => p.test(unnegated));
  if (promised.length > 0) {
    issues.push("guaranteed_outcome");
    matched.push(...promised.map((p) => `guarantee:${p.source.slice(0, 60)}`));
  }
  return { issues, matched };
}

export function checkGuardrails(
  text: string,
  allowedCents: readonly number[],
  findingType?: FindingType,
  profile: GuardrailProfile = "standard",
): GuardrailResult {
  const { issues } = scan(text, allowedCents, findingType, profile);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// Which rules matched, as the rule's own pattern (never the person's words), so a block can be
// traced in the logs.
export function guardrailMatches(
  text: string,
  allowedCents: readonly number[],
  profile: GuardrailProfile = "standard",
): string[] {
  return scan(text, allowedCents, undefined, profile).matched;
}

// A forecast of a price or the market (spec step 293): news summaries say what happened, never
// where a price is going, in every profile. "Shares slipped" is a fact; "shares could rebound"
// and "a price target of" are predictions.
const PRICE_PREDICTION = [
  /\b(?:will|would|could|should|may|might|can|going to|set to|poised to|expected to|likely to|bound to|about to|due to|ready to)\s+(?:\w+\s+){0,3}?(?:rise|rally|climb|jump|soar|surge|spike|fall|drop|decline|sink|slide|slip|plunge|plummet|tumble|crash|rebound|recover|bounce|gain|lose|double|halve|go (?:up|down)|head (?:higher|lower)|outperform|underperform|beat the market)\b/i,
  /\b(?:price|share|stock) (?:target|forecast|prediction|outlook)\b/i,
  /\btarget price\b/i,
  /\b(?:heading|headed|poised|set) (?:for )?(?:higher|lower|a (?:rally|rebound|drop|fall|crash))\b/i,
  /\b(?:upside|downside) (?:of|to)\b/i,
  /\b(?:predict\w*|forecast\w*|expect\w*)\b[^.!?]{0,40}\b(?:prices?|shares?|stocks?|the market|returns?)\b[^.!?]{0,30}\b(?:rise|rally|climb|fall|drop|recover|rebound|gain|higher|lower|up|down)\b/i,
  /\b(?:a )?(?:good|great|bad) time to (?:buy|sell)\b/i,
  /\b(?:bottom(?:ed)? out|has (?:further|more) to (?:fall|run|go))\b/i,
];

export function predictsAPrice(text: string): boolean {
  return PRICE_PREDICTION.some((pattern) => pattern.test(text));
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

export function recommendsAChoice(text: string, profile: GuardrailProfile = "standard"): boolean {
  if (profile === "demo_advice") return false;
  return RECOMMENDATION.some((pattern) => pattern.test(text));
}

// Insurance and loans, the two advice sectors the standard rules don't block by word.
const INSURANCE_OR_LOANS = [
  /\binsur/i,
  /\b(polic(y|ies)|premiums?|coverage|deductibles?|carriers?)\b/i,
  /\b(loans?|mortgages?|refinanc\w*|apr|interest rates?|lenders?|debt)\b/i,
];

// Whether text is advice that needs DEMO_ADVICE_LABEL (spec step 98): it talks about
// investments, taxes, insurance or loans, or recommends one choice over another.
export function isAdvice(text: string): boolean {
  return [...INVESTMENT, ...TAX, ...INSURANCE_OR_LOANS, ...RECOMMENDATION].some((p) =>
    p.test(text),
  );
}
