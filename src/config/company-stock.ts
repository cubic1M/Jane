// Company stock (spec step 160): RSUs, ESPP and options without too many eggs in one
// basket. FINRA's guidance ("Concentrate on the Concentration") is to keep the stock of the
// company you work for to no more than about 10% of what you've invested: if the company
// has a bad year, your job and your savings are hit at once.

export const EMPLOYER_STOCK_LIMIT = 0.1;
export const EMPLOYER_STOCK_SOURCE = "FINRA, Concentrate on the Concentration";
// The diversify plan sells in up to this many parts, this many months apart, so the gains
// (and their tax) spread over time instead of landing at once.
export const DIVERSIFY_PARTS = 4;
export const DIVERSIFY_MONTHS_APART = 3;
// The drop shown to say what the plan protects against: what a fall like this in the one
// company would cost, before and after. Single companies have fallen this much in a year.
export const COMPANY_DROP = 0.5;
// Without the person's filing status, gains are taxed at these rates (single, mid income).
export const DEFAULT_LONG_TERM_RATE = 0.15;
export const DEFAULT_SHORT_TERM_RATE = 0.22;
// A part smaller than this isn't worth an order.
export const MIN_PART_CENTS = 50_000;

export const GRANT_KINDS = {
  rsu: "Restricted stock units (RSUs)",
  espp: "Employee stock purchase plan (ESPP)",
  options: "Stock options",
} as const;
export type GrantKind = keyof typeof GRANT_KINDS;
