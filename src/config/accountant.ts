// Working with an accountant (spec step 222). FOR REVIEW.
//
// The read-only link for the person's accountant: how long it lasts, how many can be live,
// and how much an accountant can write back. The complexity factors say plainly when a
// situation is the kind people usually bring a tax professional to; they are facts about the
// person's return, not advice. Source for "people usually use one": the IRS's guidance on
// choosing a tax professional (irs.gov/tax-professionals/choosing-a-tax-professional) and
// its list of situations that make a return more complicated (Publication 17, "Do I Have to
// File a Return?" and the "What's New" notes).

export const LINK_DAYS_CHOICES = [7, 14, 30] as const;
export const DEFAULT_LINK_DAYS = 14;
export const MAX_ACTIVE_LINKS = 3;
export const LABEL_MAX = 80;
export const NAME_MAX = 80;
export const ANSWER_MAX = 2_000;
// Notes and answers one link can leave, so a leaked link can't fill the inbox.
export const MAX_NOTES_PER_LINK = 50;

// How many of the factors below make a situation "complex" (two or more).
export const COMPLEX_MIN_FACTORS = 2;
// Investment gains in the year over this much count as a factor.
export const LARGE_GAINS_CENTS = 5_000_000;

export type ComplexityKey =
  "self_employed" | "rental" | "equity" | "states" | "home_sale" | "notice" | "identity" | "gains";

// What each says when listed ("Your taxes include income from self-employment, ...").
export const COMPLEXITY_PHRASES: Readonly<Record<ComplexityKey, string>> = {
  self_employed: "income from self-employment",
  rental: "rental income",
  equity: "stock options, RSUs or crypto",
  states: "income in more than one state",
  home_sale: "the sale of a home",
  notice: "an open letter from the IRS or your state",
  identity: "a tax identity problem",
  gains: "large investment gains",
};
