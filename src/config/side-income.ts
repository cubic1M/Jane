// Side income and rentals (spec step 173). FOR REVIEW, like src/config/tax-rates.ts.
//
// Sources: IRS Publication 527 (residential rental property: depreciated over 27.5 years,
// straight line, mid-month convention; land isn't depreciated), Publication 925 (passive
// activity losses: up to $25,000 of rental loss against other income when active, phased
// out between $100,000 and $150,000 of modified AGI), Publication 535 and "Hobby or
// business?" (a hobby's income is taxable and its expenses aren't deductible; a business's
// are, and its profit bears self-employment tax). Platform payouts are reported on a
// 1099-K or 1099-NEC (TAX_FORMS and the NEC/K thresholds in src/config/tax.ts).

export const DEPRECIATION = {
  // Residential rental property.
  years: 27.5,
  // The share of the price that's the building, when the person hasn't said: land can't be
  // depreciated. ESTIMATE TO VERIFY: the county assessor's split is better.
  buildingShare: 0.8,
  // First-year percentage by the month placed in service (mid-month convention, MACRS
  // residential rental table, IRS Publication 946 table A-6).
  firstYearByMonth: [
    0.03485, 0.03182, 0.02879, 0.02576, 0.02273, 0.0197, 0.01667, 0.01364, 0.01061, 0.00758,
    0.00455, 0.00152,
  ],
  // Every full year after that, until the building's fully depreciated.
  perYear: 0.03636,
} as const;

export const PASSIVE_LOSS = {
  allowanceCents: 2_500_000,
  phaseOutFromCents: 10_000_000,
  phaseOutToCents: 15_000_000,
} as const;

// A 1099-K/NEC platform's payouts within this much of its form are "matched" (the form's
// own tolerance is TAX_DOCUMENTS in src/config/tax.ts).
export const SIDE_INCOME_MIN_CENTS = 10_000;
