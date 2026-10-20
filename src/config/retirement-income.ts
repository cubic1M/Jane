// Income in retirement (spec step 212, demo advice): turning savings into a paycheck. Every
// table here has its source; the plans built on them are ranges at the assumed returns, never
// promises. FOR REVIEW: ESTIMATE TO VERIFY each year (Social Security's bend points and
// the RMD tables change).

// People are shown this plan from this many years before retirement, or once retired.
export const PLAN_WITHIN_YEARS = 15;
// How long the money has to last: to this age.
export const PLAN_TO_AGE = 95;
export const PLAN_HORIZON_SOURCE = "Planners plan to 95 so the money outlasts a long life";

// Social Security: the share of the full-retirement-age benefit at each claiming age, for
// people born in 1960 or later (full retirement age 67). Social Security Administration.
export const SS_FULL_AGE = 67;
export const SS_CLAIM_SHARE: Readonly<Record<number, number>> = {
  62: 0.7,
  63: 0.75,
  64: 0.8,
  65: 0.8667,
  66: 0.9333,
  67: 1,
  68: 1.08,
  69: 1.16,
  70: 1.24,
};
export const SS_SOURCE = "Social Security Administration, retirement benefit by claiming age";
// Compared to this age when weighing early and late claiming ("by age 85, which has paid more").
export const SS_COMPARE_TO_AGE = 85;

// A rough estimate when the person has no statement: the 2026 bend points of Social
// Security's formula (90% / 32% / 15% of average monthly earnings), assuming their pay held
// for a career. ESTIMATE TO VERIFY; their statement at ssa.gov is better.
export const SS_BEND_POINTS_CENTS = [128_600, 774_900] as const;
export const SS_ESTIMATE_SOURCE =
  "Social Security's benefit formula with 2026 bend points; ESTIMATE TO VERIFY. Their statement at ssa.gov is better.";

// Required minimum distributions: they start at 73 for people born 1951 to 1959, and 75
// for people born in 1960 or later (SECURE 2.0 Act). IRS Uniform Lifetime Table: the
// account balance is divided by the number for the age.
export const RMD_START_AGE = (birthYear: number) => (birthYear >= 1960 ? 75 : 73);
export const RMD_SOURCE =
  "IRS Publication 590-B, Uniform Lifetime Table; SECURE 2.0 Act start ages";
export const RMD_DIVISORS: Readonly<Record<number, number>> = {
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
};
export const RMD_LAST_AGE = 100;

// What to spend each year as a share of retirement pay when the person hasn't said:
// a common target is about 80% of working pay.
export const SPEND_SHARE_OF_PAY = 0.8;
export const SPEND_SOURCE = "A common planning target: about 80% of working pay";

// The share of a withdrawal from a pre-tax account that is taxed as ordinary income is
// all of it; Roth and (mostly) taxable-account withdrawals are not. Taxable accounts: only
// the gains, assumed this share of what's taken out.
export const TAXABLE_GAINS_SHARE = 0.3;
// Without a tax estimate, the federal rate on the next dollar.
export const DEFAULT_RETIREMENT_TAX_RATE = 0.12;
