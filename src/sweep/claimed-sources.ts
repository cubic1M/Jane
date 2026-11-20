import type { Flat } from "./diff";
import { shownTexts } from "./invariants";

// Words that name a source or a thing the person's data doesn't have (debug 3's kind (b), sweeps 5
// and 7): "from the cost basis your broker reports" and "at the balance they report" for a balance
// the person typed (69, 70), "card fees" with no card (71). A sentence may say a figure comes from a
// linked bank, broker or lender, or name the person's statements, card, loan, 401(k), employer,
// policy or pay stub, only when that person's data has it (the snapshot's onFile, ./snapshot.ts).
// Pure.

type Claim = { pattern: RegExp; what: string; has: (flat: Flat, sentence: string) => boolean };

const on = (flat: Flat, key: string) => flat[`onFile.${key}`] === true;
const loan = (flat: Flat, kind: string) =>
  Object.keys(flat).some((k) => /^onFile\.loans\.\d+$/.test(k) && flat[k] === kind);

export const CLAIMS: readonly Claim[] = [
  {
    // A figure a linked broker reports.
    pattern: /\b(?:your )?broker(?:age)? reports?\b|\bas (?:your|the) broker (?:shows|reports)\b/i,
    what: "a linked investment account",
    has: (f) => on(f, "linkedInvestments"),
  },
  {
    // A figure a linked bank, card company or lender reports: a typed or uploaded balance isn't.
    pattern:
      /\b(?:the balance|the rate|the figure|what) (?:they|your bank|the bank|your lender|the lender|the card company) reports?\b|\b(?:your|the) (?:bank|lender|card company) reports\b|\bas (?:your|the) (?:bank|lender) (?:shows|reports) it\b/i,
    what: "a linked bank or lender",
    // Beside an investment or retirement account, its own link: a linked checking account doesn't
    // report a typed brokerage balance (70: "Retirement and investment accounts, at the balance they
    // report").
    has: (f, sentence) =>
      /\b(?:invest\w*|retirement|brokerage|401\(k\)|ira|funds?)\b/i.test(sentence)
        ? on(f, "linkedInvestments")
        : on(f, "linkedBank"),
  },
  {
    pattern: /\byour (?:bank )?statements?\b/i,
    what: "uploaded statements",
    has: (f) => on(f, "statements"),
  },
  {
    pattern: /\bcard fees?\b|\byour (?:credit )?cards?\b|\bon your card\b/i,
    what: "a card",
    has: (f) => on(f, "card"),
  },
  {
    pattern: /\byour student loans?\b/i,
    what: "a student loan",
    has: (f) => loan(f, "student"),
  },
  {
    pattern: /\byour (?:car|auto) loan\b|\byour car payment\b/i,
    what: "a car loan",
    has: (f) => loan(f, "auto"),
  },
  {
    pattern: /\byour mortgage\b/i,
    what: "a mortgage",
    has: (f) => loan(f, "mortgage"),
  },
  {
    pattern: /\byour 401\(k\)/i,
    what: "a 401(k)",
    has: (f) => on(f, "retirement401k") || f["profile.facts.has_401k.value"] === true,
  },
  {
    pattern: /\byour employer\b|\byour job's (?:plan|match)\b/i,
    what: "an employer",
    has: (f) => typeof f["profile.facts.employer.value"] === "string",
  },
  {
    pattern: /\byour (?:insurance )?polic(?:y|ies)\b|\bpolicy document\b/i,
    what: "a policy",
    has: (f) => on(f, "policies"),
  },
  {
    pattern: /\byour pay ?stubs?\b/i,
    what: "a pay stub",
    has: (f) => on(f, "payStub"),
  },
];

// A sentence that asks about the thing ("Do you have a mortgage?", "If you have a card …") or
// names it as missing ("you have no card") doesn't claim it.
const ASKS_OR_DENIES =
  /\?|\b(?:if|when|once|whether|unless) (?:you|your)\b|\b(?:no|without|don't have|do not have|not on file|isn't on file|aren't on file|add|upload|link|connect)\b/i;

export function claimedSources(flat: Flat): string[] {
  const found: string[] = [];
  for (const [path, text] of shownTexts(flat)) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (ASKS_OR_DENIES.test(sentence)) continue;
      for (const { pattern, what, has } of CLAIMS) {
        const m = pattern.exec(sentence);
        if (m && !has(flat, sentence)) {
          found.push(`${path}: "${m[0]}" without ${what} on file, in "${sentence.slice(0, 120)}"`);
        }
      }
    }
  }
  return found;
}
