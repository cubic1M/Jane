// The one "pick one of N" card (insurance and loans share it). A person is shown a few options,
// each short, with her pick first and a "More details" for the working; picking one queues the
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
  // Her pick. Only ever true in demo advice mode (the label shows with it).
  isPick: boolean;
  // How sure she is of the pick, with the evidence; only on the pick.
  confidence?: { percent: number; reason: string };
  // For "More details": the comparison and the working.
  details: string[];
};

export type OptionCard = {
  kind: OptionCardKind;
  title: string;
  // The need, so a pick can be re-checked on the server: "life", "auto_liability", ...
  topic: string;
  // Whether the options add cover that is missing (true) or replace what they have (false).
  newCover: boolean;
  options: CardOption[];
  // Whether Jane's advice (her pick, the label) is shown: demo advice mode.
  advice: boolean;
};

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
