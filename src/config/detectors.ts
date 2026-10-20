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
  // Urgency scores: now, soon, later.
  urgency: { now: 3, soon: 2, later: 1 },
} as const;
