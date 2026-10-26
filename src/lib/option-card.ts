// The one "pick one of N" card (insurance and loans share it). A person is shown a few options,
// each short, with its pick first and a "More details" for the working; picking one queues the
// action for the concierge team. Pure types and a validator; each sector builds its own cards.

export type OptionCardKind = "insurance" | "loan";

export type CardOption = {
  id: string;
  label: string;
  // At most OPTION_HEADLINE_WORDS words, with one number: "Lighthouse, $1,272.00 a year".
  headline: string;
  priceCents: number;
  pricePeriod: "year" | "month";
  // Short facts about what it covers or what it is.
  facts: string[];
  // One line on why this one.
  whyThisOne: string;
  // Its pick. Only ever true in demo advice mode (the label shows with it).
  isPick: boolean;
  // How sure Jane is of the pick, with the evidence; only on the pick.
  confidence?: { percent: number; reason: string };
  // For "More details": the comparison and the working.
  details: string[];
  // The numbers the comparison cards line up side by side and re-rank by (src/lib/comparison.ts).
  // Every builder sets it; a card saved in an older chat message may not have it.
  compare?: OptionCompare;
};

// One row of a comparison card: "APR" "6.90% fixed". Rows with the same key line up across the
// options, so the ones that differ can be told from the ones that don't.
export type CompareRow = { key: string; label: string; value: string };

export type OptionCompare = {
  // The headline number: what it costs a month (insurance: the yearly premium over twelve).
  monthlyCents: number;
  // What it costs in all: a year of premium, or everything paid over a loan's term, fees in.
  totalCents: number;
  // How much cover it gives, comparable within one card only (higher is more); null for loans.
  coverScore: number | null;
  // Months until the debt is gone (0: paid off now); null for insurance.
  payoffMonths: number | null;
  // Three or four rows: cover and deductible, or APR, term, total cost and fees.
  rows: CompareRow[];
  // Who it suits, in one short line: "Best for the lowest bill".
  bestFor: string;
};

export type OptionCard = {
  kind: OptionCardKind;
  title: string;
  // The need, so a pick can be re-checked on the server: "life", "auto_liability", ...
  topic: string;
  // Whether the options add cover that is missing (true) or replace what they have (false).
  newCover: boolean;
  options: CardOption[];
  // Whether Jane's advice (its pick, the label) is shown: demo advice mode.
  advice: boolean;
};

// A card offered in the chat (refs.options on a reply): the card, and for insurance the policy
// the need is about, so a pick is priced again for the same policy on the server.
export type OfferedOptions = OptionCard & { policyId?: string };

export const OPTION_HEADLINE_WORDS = 8;
export const MAX_CARD_OPTIONS = 4;

// A problem with a card, or none: the shape every builder must hold to.
export function cardProblems(card: OptionCard): string[] {
  const problems: string[] = [];
  if (card.options.length < 1 || card.options.length > MAX_CARD_OPTIONS) {
    problems.push(`${card.options.length} options`);
  }
  const ids = new Set<string>();
  for (const o of card.options) {
    if (ids.has(o.id)) problems.push(`duplicate id ${o.id}`);
    ids.add(o.id);
    if (o.headline.split(/\s+/).length > OPTION_HEADLINE_WORDS)
      problems.push(`${o.id}: headline too long`);
    if (!/\d/.test(o.headline)) problems.push(`${o.id}: headline has no number`);
    if (!Number.isInteger(o.priceCents) || o.priceCents <= 0) problems.push(`${o.id}: price`);
    if (o.whyThisOne.trim() === "") problems.push(`${o.id}: no why`);
    if (!card.advice && (o.isPick || o.confidence)) problems.push(`${o.id}: a pick without advice`);
    if (o.confidence && !o.isPick) problems.push(`${o.id}: confidence on a non-pick`);
  }
  const picks = card.options.filter((o) => o.isPick);
  if (card.advice && picks.length > 1) problems.push("more than one pick");
  if (picks.length === 1 && card.options[0] !== picks[0]) problems.push("the pick isn't first");
  return problems;
}
