// Property as an investment (spec step 214, demo advice): homes and rentals counted
// properly. FOR REVIEW: tables from the IRS; ESTIMATE TO VERIFY each year.

// Depreciation is figured once, by the taxes side (src/planning/side-income.ts, step 173).
// Land isn't depreciated: this share of the price is assumed to be land when the person
// doesn't know.
export const DEFAULT_LAND_SHARE = 0.2;

// What the rental's transactions are matched on, by default (text found in a description).
export const DEMO_RENTAL = {
  name: "Maple St rental",
  purchaseCents: 26_000_000,
  landShare: 0.2,
  placedInServiceMonth: 3,
  placedInServiceYear: 2023,
  cashInvestedCents: 6_500_000,
  loanBalanceCents: 18_200_000,
  loanRateBps: 625,
  monthlyPaymentCents: 112_000,
  rentMatch: "TENANT RENT",
  mortgageMatch: "MAPLE ST RENTAL LOAN",
  taxMatch: "COUNTY TREASURER",
  expenseMatch: "REPAIR,LANDLORD INSURANCE",
} as const;

// Mortgage paydown against investing: years compared.
export const PAYDOWN_YEARS = 10;
export const PAYDOWN_NOTE =
  "Paying down a mortgage earns its interest rate with no risk; investing can earn more or less. Mortgage interest may also be deductible, which this doesn't count.";
