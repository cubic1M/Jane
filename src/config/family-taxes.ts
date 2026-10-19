// Family taxes (spec step 169): the eligibility rules Jane checks. FOR REVIEW, like
// src/config/tax-rates.ts (the amounts are there: CHILD_TAX_CREDIT, DEPENDENT_CARE_CREDIT,
// CONTRIBUTION_LIMITS.dependentCareFsa, EDUCATION_CREDITS), from IRS Publications 972
// (child tax credit), 503 (child and dependent care), 970 (education) and 501 (filing
// status).

export const FAMILY_RULES = {
  // Child tax credit: under 17 at the end of the year, with a Social Security number, lived
  // with the person more than half the year.
  childCreditUnderAge: 17,
  // Care for a child under 13 counts for the dependent care credit and FSA.
  careUnderAge: 13,
  halfYearMonths: 6,
  // American Opportunity Credit: the first four years of college, at least half-time.
  aotcYears: 4,
  aotcFirstCents: 200_000,
  aotcSecondCents: 200_000,
  aotcSecondRate: 0.25,
  aotcRefundableShare: 0.4,
} as const;

// A choice is brought up when its better side saves at least this much.
export const FAMILY_MIN_SAVING_CENTS = 2_500;
