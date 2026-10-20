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
  // Employer match (step 262): a 401(k) balance under this share of a year's pay says the
  // match probably isn't being fully used (a year at the typical 4% each side is 8%); a
  // typical match is this share of pay.
  matchHealthyShare: 0.08,
  matchTypicalShare: 0.03,
  // Catch-up contributions for people close to retirement, and the tax rate they save at.
  catchUpCents: 750_000,
  // An HSA holding more than this is worth putting to work.
  hsaMinCents: 100_000,
  // Backdoor Roth: pay (a year) from here up, with a bonus or stock pay on top, usually reaches
  // the income limit for a direct Roth IRA; the IRA
  // limit, the growth assumed, the tax rate on that growth and the years shown.
  backdoorIncomeMinCents: 12_000_000,
  iraLimitCents: 700_000,
  assumedGrowthBps: 600,
  growthTaxRate: 0.24,
  growthYears: 10,
  // 529 plan: a yearly contribution worth showing and a typical state tax rate on it.
  college529Cents: 500_000,
  college529StateRate: 0.05,
  // Required withdrawals: the divisor for a person's early 70s, and the penalty on a miss.
  rmdDivisor: 26.5,
  rmdPenaltyRate: 0.25,
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
  // Taxes (step 261). ESTIMATES TO VERIFY, like the rest of this file; the dated figures
  // (brackets, limits, payroll tax) come from src/config/tax-rates.ts, not from here.
  tax: {
    // Pay on deposits is take-home; gross is about this many times it.
    netToGross: 1.3,
    // Company stock paid as RSUs is withheld at this flat federal rate (supplemental wages).
    rsuFlatWithholding: 0.22,
    // Without a vest schedule: one year's vesting is about this share of the stock plan.
    stockVestShare: 0.25,
    // Roth conversions: worth raising with at least this much in pre-tax retirement accounts,
    // for people close to or in retirement; converting this share a year at the 12% bracket
    // against an assumed 22% later.
    rothMinBalanceCents: 20_000_000,
    rothConvertShare: 0.1,
    rothNowRate: 0.12,
    rothLaterRate: 0.22,
    // From this month of the year a conversion is urgent (it must be done by December 31).
    rothUrgentFromMonth: 11,
    // Childcare: at least this much a year before the dependent care FSA is worth raising.
    childcareMinCents: 100_000,
    // Identity protection PIN: the IRS's January to filing season window, and the average
    // refund a thief would take (IRS filing season statistics, about $3,200), ESTIMATE.
    ipPinFrom: "01-01",
    ipPinUntil: "04-15",
    typicalRefundCents: 320_000,
    // Year end: from this day of November to December 31, a pre-tax contribution made through
    // payroll must happen before the last paycheck. Without seeing what has been put in, assume
    // this share of the yearly limit is still unused (the confidence says so).
    yearEndFrom: "11-15",
    yearEndUnusedRoomShare: 0.25,
    // Gifts: a charity gift of $250 or more needs the charity's written receipt to deduct
    // (src/config/giving.ts GIVING.receiptFromCents).
    // Property tax: worth a look from this much a year; an appeal saves about the gap
    // between the assessment and the market (src/config/property-tax.ts APPEAL_GAP_RATE).
    propertyTaxMinCents: 200_000,
    // Losses: at least this much below cost in a taxable account before harvesting is raised;
    // a loss offsets gains, then up to this much of other income a year.
    harvestMinLossCents: 100_000,
    harvestOrdinaryOffsetCents: 300_000,
    // Filing: the IRS's minimum penalty for a return more than 60 days late is about this
    // much (the lesser of it or the tax owed), ESTIMATE TO VERIFY. Filing season opens
    // January 15 and closes April 15.
    lateFilingPenaltyCents: 48_500,
    filingFrom: "01-15",
    filingUntil: "04-15",
    filingNowDays: 14,
    // Estimated payments: urgency by days to the next due date.
    estimatedNowDays: 14,
    estimatedSoonDays: 45,
  },
  // Urgency scores: now, soon, later.
  urgency: { now: 3, soon: 2, later: 1 },
} as const;
