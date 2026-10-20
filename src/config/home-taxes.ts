// Homeowner taxes (spec step 170). FOR REVIEW, like src/config/tax-rates.ts (the state
// and local tax cap is ITEMIZED.saltCap there; the energy credits ENERGY_CREDITS_2025 and
// ENERGY_CREDITS_END).
//
// Sources: IRS Publication 936 (home mortgage interest: on up to $750,000 of acquisition
// debt, $375,000 married filing separately, made permanent by the 2025 law; points on a
// purchase deductible the year paid, on a refinance over the loan's life), Publication 523
// (selling your home: up to $250,000 of gain excluded, $500,000 married filing jointly,
// after owning and living in it 2 of the last 5 years).

export const MORTGAGE_DEBT_LIMIT = {
  normal: 75_000_000,
  marriedSeparate: 37_500_000,
} as const;

export const HOME_SALE_EXCLUSION = {
  normal: 25_000_000,
  marriedJoint: 50_000_000,
  // Owned and lived in for this many days of the 5 years before the sale.
  daysOfFiveYears: 730,
} as const;

// Payments to a county or city tax office for property tax.
export const PROPERTY_TAX_PAYEE =
  /\b(?:PROPERTY TAX|PROP TAX|REAL ESTATE TAX|COUNTY TAX|TAX COLLECTOR|TREASURER|ASSESSOR)\b/i;

// Spending that may be a home improvement (it adds to the home's cost basis; repairs
// don't): these categories, at least this much each.
export const IMPROVEMENT_CATEGORIES = [
  "HOME_IMPROVEMENT_HARDWARE",
  "HOME_IMPROVEMENT_SECURITY",
  "HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT",
] as const;
export const IMPROVEMENT_MIN_CENTS = 100_000;
