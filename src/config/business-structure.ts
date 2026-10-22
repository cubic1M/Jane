// Business owners' tax structure (spec step 267). FOR REVIEW: estimates a person and their
// accountant should check. Dated tax figures (brackets, the self-employment and payroll
// tax rates, the qualified business income deduction's rate and limits) are in
// src/config/tax-rates.ts; these are the S-corporation costs and the rules of thumb for pay.
//
// Sources: IRS Topic 413 / Publication 535 (qualified business income deduction), IRS
// "S corporations" and "Wages and salaries of S corporation shareholders" (reasonable
// compensation: no fixed percentage, the facts decide), Form 2553 (the election), Revenue
// Ruling 74-44 (reasonable pay). Costs are typical, ESTIMATE TO VERIFY with a local preparer.

export const S_CORP = {
  // A salary range as a share of profit that is commonly defended as reasonable for a
  // working owner, and the floor under it. The IRS looks at what the work would pay a
  // stranger; this is a starting point for the conversation, not a rule.
  salaryShareLow: 0.4,
  salaryShareHigh: 0.6,
  salaryFloorCents: 3_500_000,
  // What running an S corporation adds each year: a payroll service, a corporate return
  // (Form 1120-S), the extra state filing. Together, ESTIMATE TO VERIFY.
  payrollServiceCents: 120_000,
  corporateReturnCents: 120_000,
  stateFilingCents: 30_000,
  // Worth raising only if it saves at least this much after the costs.
  minSavingCents: 100_000,
} as const;

export const S_CORP_COSTS_CENTS =
  S_CORP.payrollServiceCents + S_CORP.corporateReturnCents + S_CORP.stateFilingCents;

// Home office, simplified method: $5 a square foot up to 300 (src/config/tax-rates.ts
// HOME_OFFICE_SIMPLIFIED). A worker at home is usually in a room of at least this many square
// feet; we use the most the simplified method allows when nothing is on file.
export const HOME_OFFICE_ASSUMED_SQFT = 150;

// A driver who drives for the business: miles to assume when none are logged, before Jane
// asks. A typical self-employed driver logs a few thousand.
export const VEHICLE_ASSUMED_MILES = 4_000;
