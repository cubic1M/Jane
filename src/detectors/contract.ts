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

export type Suggestion = {
  // "<capability>:<topic>": stable, so the same suggestion is never shown twice after a no.
  id: string;
  capability: string;
  topic: SuggestionTopic | "strategist";
  // One sentence: what Jane suggests.
  title: string;
  worthCents: number;
  worthKind: WorthKind;
  confidence: Confidence;
  urgency: Urgency;
  // Why this person, in their own figures: "you pay $1,240; people like you pay about $600".
  why: string;
  // The button: where it goes (a page or a registered chat action).
  action: { label: string; href: string };
  // A strategist idea (step 256) combines several detectors' suggestions: their ids, and
  // every button they offer. Detectors leave both out.
  parts?: string[];
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
  detect: (ctx: DetectorContext) => Suggestion | null;
};

export const suggestionId = (capability: string, topic: SuggestionTopic) =>
  `${capability}:${topic}`;
