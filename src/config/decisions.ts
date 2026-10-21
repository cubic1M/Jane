// "Should I ...?" questions (src/lib/jane-agent/decision.ts) belong to the sector whose subject
// they are. The core router reads the question, works out the subject, and hands it to the
// capability whose `decides` lists it (src/lib/jane-agent/capabilities/shared.ts, Capability.
// decide). Subjects no sector claims get the general answer (card debt, cushion, goals).
//
// Core subjects: crypto, stocks, invest, payoff_or_invest (investing's), home, car, other.
// A sector adds a subject of its own by adding a line to SECTOR_DECISIONS: its subject id and
// the wording that means it (matched on the lower-cased question once it has been read as
// "should I ..."). One line per subject, in your own sector's block, nothing else to touch in
// the router. docs/decisions.md has the whole shape.

export const SECTOR_DECISIONS: readonly { item: string; pattern: RegExp }[] = [
  // insurance: { item: "insurance", pattern: /\b(?:life|renters|umbrella|disability) insurance\b/ },
  // Loans and debt (src/lib/jane-agent/debt-decide.ts): consolidating, a personal loan, a
  // payday loan, closing a card, the student loan early, savings against debt, buy now pay
  // later. Refinancing keeps its own offers answer.
  {
    item: "loan",
    pattern:
      /^(?!.*\$\s?\d).*\b(?:consolidat\w*|personal loan|payday (?:loan|advance|lender)s?|cash advance|close (?:a |an |my |this |that )?(?:credit )?card|pay(?:ing)? (?:off|down) (?:my )?student (?:loans?|debt)|student (?:loans?|debt)\b.*\b(?:early|faster|ahead)|buy now,? pay later|bnpl|klarna|afterpay|affirm|(?:use|using|take|tap) (?:my )?(?:savings|cash|emergency fund)\b.*\b(?:debt|cards?|loans?))\b/,
  },
  // taxes: { item: "tax", pattern: /\b(?:roth|hsa|itemiz\w*|standard deduction)\b/ },
];
