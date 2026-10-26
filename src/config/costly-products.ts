// What costly products really cost (spec step 215, demo advice): variable annuities, whole
// life cash value and advisory accounts, in dollars. Nothing is recommended on real accounts.
// FOR REVIEW: the typical fees below are examples from public disclosures; a person's own
// contract or statement always wins.

export type ProductKind = "annuity" | "whole_life" | "advisory";

// What the same money costs in a low-cost index fund, a year (basis points).
export const LOW_COST_BPS = 4;
export const LOW_COST_SOURCE = "A broad index fund like the demo's (src/config/funds.ts)";

// How long the comparison runs.
export const COMPARE_YEARS = 20;
// Exit comparisons look this many years ahead.
export const EXIT_HORIZON_YEARS = 10;
// Leaving or waiting has to save at least this much (cents) over the horizon to be worth
// saying; below it, staying is fine.
export const EXIT_MIN_SAVING_CENTS = 50_000;

// A common surrender schedule: the share charged for leaving in contract year 1, 2, ...
// (zero after the last). The person's own contract wins.
export const TYPICAL_SURRENDER_PCT = [7, 6, 5, 4, 3, 2, 1] as const;

// Tax notes shown with every exit figure.
export const ANNUITY_TAX_NOTE =
  "Gains taken out of an annuity are taxed as ordinary income (and before 59½ there's usually a 10% penalty). A 1035 exchange to another annuity, or a rollover when it's held in an IRA, avoids the tax.";
export const WHOLE_LIFE_NOTE =
  "Ending whole life also ends the death benefit. Check you still need the cover before you leave.";

// Payments that look like a life insurer's premiums, found in the person's transactions:
// they're asked about once ("Is this a whole life policy?").
export const LIFE_INSURER_PATTERNS = [
  "NORTHWESTERN MUTUAL",
  "NEW YORK LIFE",
  "MASSMUTUAL",
  "MASS MUTUAL",
  "MUTUAL OF OMAHA",
  "PENN MUTUAL",
  "GUARDIAN LIFE",
  "PRUDENTIAL LIFE",
  "LIFE INS PREMIUM",
] as const;
// A found premium must be at least this much a year (cents) to be asked about.
export const MIN_PREMIUM_CENTS = 60_000;
// Jane brings a product up only when it costs at least this much a year (cents).
export const MIN_YEARLY_COST_CENTS = 30_000;

// The demo bank's products (demo-bank people link them to try the step).
export const DEMO_ANNUITY = {
  name: "Lifetrust variable annuity",
  provider: "Lifetrust Insurance",
  valueCents: 8_500_000,
  feeBps: 255,
  yearsAgo: 3,
  schedule: [7, 6, 5, 4, 3, 2, 1],
} as const;
export const DEMO_WHOLE_LIFE = {
  name: "Whole life policy",
  provider: "Mutual Heritage Life",
  cashValueCents: 2_840_000,
  premiumYearlyCents: 600_000,
  yearsAgo: 6,
  schedule: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
} as const;
