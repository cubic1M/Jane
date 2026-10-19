// The retirement planner (spec step 132): contribution limits, the target and the rules
// of thumb behind it, each with its source. Projections use the returns and inflation in
// src/config/market-assumptions.ts and are always shown as a range.

// 2026 limits (IRS Notice 2025-67): what a person may put into a 401(k), 403(b) or 457(b)
// plan from their pay, the extra from 50 (catch-up) and the larger extra at 60 to 63, and
// IRA limits.
export const LIMITS_YEAR = 2026;
export const EMPLOYEE_DEFERRAL_LIMIT_CENTS = 2_450_000;
export const CATCH_UP_AGE = 50;
export const CATCH_UP_CENTS = 800_000;
export const SUPER_CATCH_UP_AGES = [60, 63] as const;
export const SUPER_CATCH_UP_CENTS = 1_125_000;
export const IRA_LIMIT_CENTS = 750_000;
export const IRA_CATCH_UP_CENTS = 110_000;
export const LIMITS_SOURCE = "IRS Notice 2025-67 (2026 limits)";

// When the projection stops: the full Social Security retirement age for anyone born in
// 1960 or later (Social Security Administration).
export const RETIREMENT_AGE = 67;
export const RETIREMENT_AGE_SOURCE =
  "Social Security's full retirement age for people born in 1960 or later";

// The target: about ten times your yearly pay saved by 67 (Fidelity's savings guideline),
// in today's dollars.
export const TARGET_TIMES_PAY = 10;
export const TARGET_SOURCE = "Fidelity's guideline: about 10 times your pay saved by 67";

// What a nest egg could pay out each year: 4% of it, the usual starting rate from studies
// of past markets (Bengen, 1994; the Trinity study, 1998). A rule of thumb, not a promise.
export const WITHDRAWAL_RATE = 0.04;
export const WITHDRAWAL_SOURCE = "The 4% rule of thumb (Bengen 1994; Trinity study 1998)";

// Roth or traditional, by yearly pay, for a single filer: below the first line the person
// is likely in the 10% or 12% federal bracket, where paying the tax now (Roth) usually
// wins; above the second, in the 32% bracket or higher, where the deduction now
// (traditional) usually wins; in between, a mix. Pay before deductions, so the lines sit
// above the bracket edges by about the standard deduction. To be replaced by the taxes
// lane's brackets and the person's filing status (src/config/tax-rates.ts) when it lands.
export const ROTH_BELOW_PAY_CENTS = 6_500_000;
export const TRADITIONAL_ABOVE_PAY_CENTS = 21_500_000;
export const ROTH_SOURCE =
  "Federal brackets for a single filer: 12% and below favours Roth, 32% and above traditional";

// Contributions from the employer, by the investment transaction's name (Plaid gives one
// "contribution" subtype for both).
export const EMPLOYER_CONTRIBUTION = /\b(?:match|employer|company|profit sharing|safe harbor)\b/i;

// Suggesting more each year: never more than this share of pay at once.
export const MAX_SUGGESTED_RAISE = 0.1;
