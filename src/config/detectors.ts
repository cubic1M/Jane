// Numbers the detectors (spec step 254) use: what counts as enough to suggest, and the rates
// that turn what Jane sees into dollars a year. Never inline in src/detectors.

export const DETECTOR_RATES = {
  // Subscriptions: at least this many small monthly charges, and the share people usually
  // trim when they look at the list.
  subscriptionsMin: 3,
  subscriptionMinCharges: 3,
  subscriptionMaxCents: 10_000,
  subscriptionTrimShare: 0.25,
  // Fees: this many overdraft, late or insufficient-funds fees in the year.
  feesMin: 2,
  // Card interest: this much interest charged in the year.
  interestMinCents: 20_000,
  // Idle cash: keep this many months of spending, and count only more than this over it.
  // Moving the rest to a high-yield account earns the difference in the rates below.
  idleMonthsKept: 6,
  idleMinExcessCents: 1_000_000,
  highYieldBps: 400,
  currentCashBps: 10,
  // Emergency fund: months of spending to hold, by how steady the income is.
  emergencyMonthsSteady: 3,
  emergencyMonthsUneven: 6,
  // PMI usually costs about this much of the loan a year.
  pmiBps: 50,
  // Refinance: worth looking when today's rate is this far below the loan's.
  marketMortgageBps: 620,
  refinanceMinGapBps: 50,
  // Self-employed tax: a typical combined rate, and the underpayment penalty on what's
  // owed but not paid in on time.
  selfEmployedTaxRate: 0.25,
  underpaymentPenaltyRate: 0.08,
  // Self-employed retirement: the share of income that can go into a SEP IRA or solo 401(k)
  // (capped at 20% of net), and the tax rate it saves at.
  selfRetireShare: 0.1,
  selfRetireTaxRate: 0.22,
  // Life insurance: a common rule of thumb is this many years of income.
  lifeCoverYears: 10,
  // Company stock: too much in one company when it is this share of what they invest.
  concentrationShare: 0.3,
  concentrationDropShare: 0.3,
  // Late fees: one is enough to mention.
  lateFeesMin: 1,
  // Payday and cash-advance loans: fees are about this share of what's repaid.
  paydayFeeShare: 0.25,
  // Income that moves around by this much month to month is worth smoothing.
  smoothingMinMonthlySwingShare: 0.3,
  // Insurance (spec step 259). The yearly cost avoided if the cover is missing when it is
  // needed, as typical figures from the insurance lane's gap advice: contents a renter loses,
  // a liability claim a car can face.
  rentersContentsCents: 3_000_000,
  autoLiabilityCents: 10_000_000,
  // A hospital stay with no health cover.
  uninsuredStayCents: 2_700_000,
  // Long-term care: a typical year in a care home, and the years a couple near retirement
  // is told to plan for.
  longTermCareYearCents: 10_800_000,
  longTermCareYears: 2,
  // Umbrella cover matters when assets pass this (src/config/insurance.ts UMBRELLA_ASSETS_CENTS).
  umbrellaAssetsCents: 50_000_000,
  // Comparing a health plan, a Medicare supplement or car and home cover usually finds this
  // share of the premium, stated as "up to".
  healthCompareShare: 0.1,
  medigapCompareShare: 0.12,
  insuranceShopShare: 0.1,
  // Shopping car and home cover is only worth a message above this yearly premium, with at
  // least this many monthly charges seen.
  insuranceShopMinCents: 100_000,
  insuranceShopMinCharges: 6,
  // Long-term care is raised for people this close to retirement with at least this much.
  longTermCareMinAssetsCents: 40_000_000,
  // Urgency scores: now, soon, later.
  urgency: { now: 3, soon: 2, later: 1 },
} as const;
