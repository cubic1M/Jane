// What a claim stood on, and whether that is enough to say it (card-chat mismatch; the design is
// in the shared notes, card-chat-mismatch.md). The founder's /deadlines said a movie ticket and a
// bookstore receipt "renew" every year: one charge and a category, said as a fact. Every deadline
// Jane works out from the charges now says what it saw, and this one rule decides: a statement, a
// question for the person, or nothing.
//
// - word: the bank's words say it ("ANNUAL MEMBERSHIP", "ANNUAL FEE").
// - known_merchant: the merchant sells exactly that (a SUBSCRIPTION_MERCHANTS plan by its name).
// - pattern: the same charge seen `times` times on a schedule.
// - seen_rise: a price seen going up.
// - seen_charge: the charge itself (a purchase, for its return window).
// - category_only: only the bank's category says so.
// - reported: the bank or lender reports it (a payment's due date).
// - entered: the person typed it in, or it is on their policy or document.

export type EvidenceKind =
  | "word"
  | "known_merchant"
  | "pattern"
  | "seen_rise"
  | "seen_charge"
  | "category_only"
  | "reported"
  | "entered";

export type Evidence = { kind: EvidenceKind; times?: number };

export type Says = "statement" | "question" | "nothing";

// A regular charge is a pattern from this many charges on.
export const PATTERN_MIN_TIMES = 2;

// What each kind of deadline (src/insights/deadlines.ts DeadlineKind) needs to be said as a fact.
// Anything a person entered, a document says or a lender reports is always enough. A category
// alone is never a fact: at most a question ("Is this a yearly plan?").
export const DEADLINE_EVIDENCE: Readonly<
  Record<string, { statement: readonly EvidenceKind[]; question: readonly EvidenceKind[] }>
> = {
  // "Renews" needs a seen cycle, or a charge that names the plan.
  renewal: { statement: ["word", "known_merchant", "pattern"], question: ["category_only"] },
  // "Price goes up" needs a seen rise, or an intro price's flat run of charges.
  price_rise: { statement: ["seen_rise", "pattern"], question: [] },
  // "Trial ends" needs a charge from a plan Jane knows or the bank's words.
  trial: { statement: ["word", "known_merchant"], question: ["category_only"] },
  // "Return by" needs the purchase.
  return: { statement: ["seen_charge"], question: [] },
  payment: { statement: ["reported", "entered"], question: [] },
  fsa: { statement: ["entered"], question: [] },
  card_benefit: { statement: ["entered"], question: [] },
  warranty: { statement: ["entered"], question: [] },
  other: { statement: ["entered"], question: [] },
};

// How sure a claim can say it is, at most, by what it stood on (percent).
export const EVIDENCE_CONFIDENCE_CAP: Readonly<Record<EvidenceKind, number>> = {
  entered: 100,
  reported: 95,
  seen_charge: 95,
  word: 85,
  known_merchant: 80,
  seen_rise: 85,
  pattern: 80,
  category_only: 40,
};

// The one rule: what a deadline of this kind may say on this evidence.
export function deadlineSays(kind: string, evidence: Evidence | undefined): Says {
  const needs = DEADLINE_EVIDENCE[kind];
  if (!needs || !evidence) return "nothing";
  if (evidence.kind === "pattern" && (evidence.times ?? 0) < PATTERN_MIN_TIMES) {
    return needs.question.includes("category_only") ? "question" : "nothing";
  }
  if (evidence.kind === "entered" || evidence.kind === "reported") return "statement";
  if (needs.statement.includes(evidence.kind)) return "statement";
  if (needs.question.includes(evidence.kind)) return "question";
  return "nothing";
}
