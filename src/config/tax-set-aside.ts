// The tax left to cover (src/planning/tax-set-aside.ts): when it's worth bringing up, how sure Jane
// can be, and what a person can point out on the calculation. The tax rates themselves are in
// src/config/tax-rates.ts.

export const TAX_SET_ASIDE = {
  // Less than this left to cover isn't worth a card or a line in Safe to spend.
  minLeftCents: 10_000,
  // Confidence starts here and only falls: it's an estimate from a person's accounts.
  topPercent: 85,
  // The fewest months of income seen, and the most Jane can be sure with fewer.
  monthsCaps: [
    { under: 3, percent: 40 },
    { under: 6, percent: 55 },
    { under: 9, percent: 70 },
  ],
  // Each thing Jane doesn't know, and the most it can be sure without it. First transactions after
  // this day of the year mean a part-year file: nobody's first deposit falls on Jan 1.
  partYearAfter: "01-31",
  partYearPercent: 60,
  withholdingUnknownPercent: 50,
  filingStatusAssumedPercent: 75,
  stateUnknownPercent: 65,
  businessCostsUnknownPercent: 65,
  // A pay stub older than this is projected at its pace rather than read as today's.
  stubFreshDays: 35,
} as const;

// An account or a goal with this in its name is money kept for tax.
export const TAX_KEPT_NAME = /\btax(?:es)?\b/i;

export const TAX_CORRECTION_KINDS = [
  // "That isn't income": a payer's deposits, this year's and later ones.
  "not_income",
  // "That number's wrong": the year's wages or self-employment income so far.
  "wages",
  "self_employed",
  // "That number's wrong": federal income tax withheld from pay so far.
  "withheld",
  // "That's a deduction": a cost of their work (lowers self-employment tax too), or anything else.
  "business_cost",
  "deduction",
  // "I paid this": a tax payment Jane can't see.
  "paid",
  // Money the person already keeps apart for this tax, somewhere Jane can't tell.
  "kept_apart",
] as const;
export type TaxCorrectionKind = (typeof TAX_CORRECTION_KINDS)[number];

// One number for the year: a new one replaces the old.
export const ONE_PER_YEAR: readonly TaxCorrectionKind[] = [
  "wages",
  "self_employed",
  "withheld",
  "kept_apart",
];

export const TAX_CORRECTION_MAX_CENTS = 1_000_000_000;
export const TAX_CORRECTION_LABEL_MAX = 80;
