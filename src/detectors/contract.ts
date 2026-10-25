import type { SuggestionTopic } from "@/config/people";
import type { Profile, ProfileInput } from "@/profile/build";
import type { FactKey } from "@/profile/facts";

// The detector contract (spec step 254). Every capability in the chat registry has one or
// more detectors. A detector is a pure function: given the person's profile (and the rows
// behind it), does this apply to them, what is it worth, how sure is Jane, how urgent is it,
// why them, and what button does it offer. Detectors never write, never call out and never
// read the database: the nightly scan (step 255) loads the person once and runs them all, and
// the harness (./harness.ts) runs them on the eight sample people against their written lists.
// docs/detectors.md has the contract and two worked examples.

export const HEADLINE_MAX = 60;
// Eight words at most: the card is read in a glance (founder: "very concise").
export const HEADLINE_MAX_WORDS = 8;

// The headline as the floating card shows it ("Cancel Planet Fitness, save $588/yr"): the
// yearly figure shortened so the number reads in a glance, and a risk said as what it protects
// ("Look at life cover for your family, protect $1,287,200"; QA: "avoid $1,287,200" read
// oddly). Never longer than "avoid $X" was: a card headline is nine words at most.
export function cardHeadline(headline: string): string {
  return headline
    .replace(/[.!?]+$/, "")
    .replace(/\s+a year\b/g, "/yr")
    .replace(/\bavoid up to\b/, "protect");
}
export const SHORT_MAX = 120;

export type Urgency = "now" | "soon" | "later";

// What a suggestion is worth, in cents a year: "saves" (spend less), "earns" (money
// that would otherwise sit idle) or "risk" (a cost avoided if something goes wrong).
export type WorthKind = "saves" | "earns" | "risk";

export type Confidence = {
  // A whole percentage, worked out from the evidence (src/profile/confidence.ts): how
  // likely the suggestion is right for this person and worth the stated amount. Never a
  // promise about markets or outcomes.
  percent: number;
  // The evidence behind it, shown beside it: "3 overdraft fees in 12 months of data".
  reason: string;
};

// What the person's later transactions should show once they act on a suggestion: the verified
// savings record (src/lib/outcomes.ts) checks it each night. Payees are the charges' own
// descriptions. A detector whose saving can't be seen in transactions leaves it out.
export type Watch =
  // Charges that should stop (a cancelled subscription or trial): each payee, its usual charge
  // and how often it comes a year.
  | {
      kind: "charge_stops";
      payees: { description: string; amountCents: number; perYear: number }[];
    }
  // A bill that should come in lower: each payee and its price before, and how often a year.
  | { kind: "bill_drops"; payees: { description: string; beforeCents: number; perYear: number }[] }
  // Money that should come back from a payee: at least about this much.
  | { kind: "refund"; payees: { description: string; amountCents: number }[] }
  // Fees of these categories that should stop: what they came to a month before.
  | { kind: "fee_stops"; pfcs: string[]; monthlyCents: number };

export type Suggestion = {
  // "<capability>:<topic>": stable, so the same suggestion is never shown twice after a no.
  id: string;
  capability: string;
  topic: SuggestionTopic | "strategist";
  // One sentence: what Jane suggests.
  title: string;
  // The suggestion at a glance (docs/detectors.md, "Short forms"): a headline of at most
  // HEADLINE_MAX characters that starts with a verb and carries the dollars ("Cancel Hulu,
  // save $216 a year"), and one "why you" line of at most SHORT_MAX characters with the
  // person's own number. The full title and why stay behind a "Why?" tap.
  headline: string;
  short: string;
  worthCents: number;
  worthKind: WorthKind;
  confidence: Confidence;
  urgency: Urgency;
  // Why this person, in their own figures: "you pay $1,240; people like you pay about $600".
  why: string;
  // The button: where it goes (a page or a registered chat action).
  action: { label: string; href: string };
  // What later transactions should show if the person acts (the verified savings record).
  watch?: Watch;
  // A strategist idea (step 256) combines several detectors' suggestions: their ids, and
  // every button they offer. Detectors leave both out.
  parts?: string[];
  // What ranking counts it for, in cents: its parts' worth, risk at its reduced weight.
  rankCents?: number;
  // The worth is already an expected yearly value (loss x chance, as the insurance detectors
  // report it), so ranking counts it in full rather than discounting it again.
  worthIsExpected?: boolean;
  // Cover or action the law or a lender requires (car liability), or no cover at all for a
  // business: ranked above its dollars alone (REQUIRED_BOOST).
  required?: boolean;
  more?: { label: string; href: string }[];
};

export type DetectorContext = { profile: Profile; data: ProfileInput };

export type Detector = {
  // The registry capability this detector belongs to (src/lib/jane-agent/capabilities).
  capability: string;
  topic: SuggestionTopic;
  // Facts the profile must know for this to be judged. When one is missing and the rest fit,
  // the question worth asking (step 257) is built from it.
  needs: readonly FactKey[];
  // The registry tools (the features Claude can look at, src/lib/jane-agent/claude-tools.ts)
  // this detector brings to the person unasked. Every tool is covered by at least one detector
  // or exempt with a reason (src/config/detector-exempt.ts), or is on the shrinking list in
  // ./missing.ts. [] when it surfaces something no tool covers.
  covers: readonly string[];
  detect: (ctx: DetectorContext) => Suggestion | null;
};

export const suggestionId = (capability: string, topic: SuggestionTopic) =>
  `${capability}:${topic}`;
