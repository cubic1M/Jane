// The tax side of health insurance (spec step 269). FOR REVIEW. Dated tax figures (the HSA
// limits, the standard deduction) are in src/config/tax-rates.ts; these are the Marketplace
// premium tax credit's thresholds and the medical deduction's floor.
//
// Sources: IRS Publication 974 (premium tax credit), Form 8962, Rev. Proc. 2025-25 (the 2026
// applicable percentage table and repayment limits), HHS 2025 poverty guidelines for 2026
// coverage, IRS Publication 969 (HSAs: the excise tax on excess contributions) and Publication
// 502 (the medical and dental deduction). The enhanced subsidies expired after 2025, so for
// 2026 the credit stops above 400% of the poverty line again. ESTIMATE TO VERIFY every figure.

const $ = (d: number) => Math.round(d * 100);

// The federal poverty line (48 states) used for 2026 coverage: a person and each more.
export const FPL = { first: $(15_650), each: $(5_500) } as const;
export const fplFor = (householdSize: number) =>
  FPL.first + FPL.each * Math.max(0, householdSize - 1);

// Above this share of the poverty line there is no credit, so every advance dollar is repaid.
export const PTC_CLIFF = 4.0;

// What a household is expected to pay toward the benchmark plan, as a share of income, by share
// of the poverty line: linear between points.
export const APPLICABLE_PERCENT: readonly { fpl: number; pct: number }[] = [
  { fpl: 1.33, pct: 0.021 },
  { fpl: 1.5, pct: 0.0314 },
  { fpl: 2.0, pct: 0.066 },
  { fpl: 2.5, pct: 0.0844 },
  { fpl: 3.0, pct: 0.0996 },
  { fpl: 4.0, pct: 0.0996 },
];

// The most that must be repaid when income is under the cliff and advance credits were too
// large: by share of the poverty line, one person and others.
export const REPAYMENT_CAPS: readonly { under: number; single: number; other: number }[] = [
  { under: 2.0, single: $(375), other: $(750) },
  { under: 3.0, single: $(950), other: $(1_900) },
  { under: 4.0, single: $(1_575), other: $(3_150) },
];

// Without seeing the advance credit: a typical monthly one for a single adult who enrolled at a
// lower income, and a benchmark plan's premium, used only when the person hasn't said.
export const ASSUMED_APTC_MONTHLY_CENTS = $(350);
export const ASSUMED_BENCHMARK_MONTHLY_CENTS = $(600);

// Medical and dental costs are deductible only above this share of adjusted gross income, and
// only if the person itemizes.
export const MEDICAL_FLOOR = 0.075;

// The excise tax on HSA contributions over the limit, each year the excess stays in.
export const HSA_EXCESS_EXCISE = 0.06;

// Payments that look like Marketplace premiums.
export const MARKETPLACE_PAYEE =
  /HEALTHCARE\.GOV|MARKETPLACE|COVERED CALIFORNIA|COVERED CA\b|CONNECT FOR HEALTH|HEALTHSHERPA/i;
