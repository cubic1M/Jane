// The tax side of health insurance (spec step 269). FOR REVIEW. Dated tax figures (the HSA
// limits, the standard deduction, the medical deduction's 7.5% floor) are in
// src/config/tax-rates.ts; these are the Marketplace premium tax credit's thresholds and Jane's
// own rules for raising them.
//
// Sources: IRS Publication 974 (premium tax credit) and Form 8962; Rev. Proc. 2025-25 (the 2026
// applicable percentage table, 2.10% to 9.96%); HHS 2025 poverty guidelines (used for 2026
// coverage); the One Big Beautiful Bill Act (P.L. 119-21) section 71305, which removes the cap on
// repaying excess advance credit from tax year 2026; IRS Publication 969 (HSAs: the 6% excise tax
// on excess contributions, removed without it by the filing deadline) and Publication 502 (the
// medical and dental deduction). The enhanced subsidies of 2021 to 2025 expired, so for 2026 the
// credit stops above 400% of the poverty line again. ESTIMATE TO VERIFY every figure each year.

const $ = (d: number) => Math.round(d * 100);

// The federal poverty line (48 states) used for 2026 coverage: one person, and each more.
export const FPL = { year: 2026, first: $(15_650), each: $(5_500) } as const;
export const fplFor = (householdSize: number) =>
  FPL.first + FPL.each * Math.max(0, householdSize - 1);

// Above this share of the poverty line there is no credit, so every advance dollar is repaid.
export const PTC_CLIFF = 4.0;

// What a household is expected to pay toward the benchmark plan, as a share of its income, by
// share of the poverty line: each band rises evenly from its first to its last percentage (Rev.
// Proc. 2025-25, for 2026).
export const APPLICABLE_PERCENT: readonly { upTo: number; from: number; to: number }[] = [
  { upTo: 1.33, from: 0.021, to: 0.021 },
  { upTo: 1.5, from: 0.0314, to: 0.0419 },
  { upTo: 2.0, from: 0.0419, to: 0.066 },
  { upTo: 2.5, from: 0.066, to: 0.0844 },
  { upTo: 3.0, from: 0.0844, to: 0.0996 },
  { upTo: 4.0, from: 0.0996, to: 0.0996 },
];

// The most that must be repaid when advance credits were too large, by tax year: by share of
// the poverty line, one person and others. Empty from 2026: all of it is repaid (OBBBA 71305).
export const REPAYMENT_CAPS: Readonly<
  Record<number, readonly { under: number; single: number; other: number }[]>
> = {
  2025: [
    { under: 2.0, single: $(375), other: $(750) },
    { under: 3.0, single: $(950), other: $(1_900) },
    { under: 4.0, single: $(1_575), other: $(3_150) },
  ],
  2026: [],
};

// The benchmark (second-cheapest silver) plan's monthly premium, used only when the person
// hasn't told Jane theirs: about the 2026 national average for a 40-year-old (KFF, "Marketplace
// average benchmark premiums"). Rough; each extra person adds about the same again, less for
// children (counted at half).
export const ASSUMED_BENCHMARK_MONTHLY_CENTS = $(625);
export const BENCHMARK_CHILD_SHARE = 0.5;

// The advance credit is set at enrollment from the income the person expected. Without their
// figure, Jane takes it as the pace of the year's first months, annualized.
export const ENROLLMENT_MONTHS = 3;
// The rest of the year is projected at the pace of the last few full months, so a mid-year
// rise shows.
export const RECENT_MONTHS = 3;

// A repayment worth raising.
export const PTC_MIN_REPAY_CENTS = $(300);

// Payments that look like Marketplace premiums.
export const MARKETPLACE_PAYEE =
  /HEALTHCARE\.GOV|MARKETPLACE|COVERED CALIFORNIA|COVERED CA\b|CONNECT FOR HEALTH|HEALTHSHERPA/i;

// Health premiums paid from the person's own pocket count as medical costs for the deduction:
// Medicare, a Medicare supplement or drug plan, a Marketplace plan.
export const HEALTH_PREMIUM =
  /MEDICARE|MEDIGAP|PART D|HEALTHCARE\.GOV|MARKETPLACE|COVERED CALIFORNIA|DENTAL INSURANCE/i;

// The excise tax on HSA contributions over the limit, each year the excess stays in.
export const HSA_EXCESS_EXCISE = 0.06;
// The age from which the HSA limit has a catch-up (Publication 969).
export const HSA_CATCH_UP_AGE = 55;
// Deposits into an HSA from outside it (payroll or a transfer).
export const HSA_DEPOSIT = /HSA|HEALTH SAVINGS/i;

// A medical deduction worth raising: what itemizing with it saves.
export const MEDICAL_MIN_SAVING_CENTS = $(100);
