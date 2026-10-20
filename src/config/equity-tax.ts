// Crypto and equity pay, taxed right (spec step 219). FOR REVIEW, like src/config/tax-rates.ts.
//
// Sources: IRS Publication 525 (taxable income: stock options, RSUs), Publication 550
// (ESPP and ISO sales; holding periods), Form 6251 and its instructions (the alternative
// minimum tax), Publication 15 / Topic 424 (supplemental wage withholding), Notice 2014-21
// (crypto is property: sales are capital gains), Form 1099-DA (digital asset proceeds,
// brokers report from 2025, cost basis from 2026).

// ESPP: a sale is a qualifying disposition only if it's more than 2 years after the offering
// (grant) date AND more than 1 year after the shares were bought. Otherwise it's
// disqualifying: the discount is ordinary income, not capital gain.
export const ESPP_RULES = { yearsAfterGrant: 2, yearsAfterPurchase: 1 } as const;

// ISOs: exercising and holding past the year's end counts the spread (market price less
// the strike, times the shares) as an AMT preference; selling in the year of exercise is a
// disqualifying disposition (ordinary income, no AMT preference). Holding for 2 years from
// the grant and 1 year from the exercise makes the sale a long-term gain.
export const ISO_RULES = { yearsAfterGrant: 2, yearsAfterExercise: 1 } as const;

// The alternative minimum tax, 2026 (ESTIMATE TO VERIFY: Rev. Proc. 2025-32 figures; the
// exemption amounts and thresholds are indexed each year). Tentative minimum tax is 26% of
// AMT income over the exemption up to the 28% threshold and 28% above; the exemption
// shrinks by 25 cents for each dollar over the phase-out start. AMT is what it exceeds the
// regular tax by.
const $ = (dollars: number) => Math.round(dollars * 100);
export const AMT = {
  exemption: {
    single: $(90_100),
    married_joint: $(140_200),
    married_separate: $(70_100),
    head_of_household: $(90_100),
  },
  phaseOutStart: {
    single: $(500_000),
    married_joint: $(1_000_000),
    married_separate: $(500_000),
    head_of_household: $(500_000),
  },
  phaseOutRate: 0.25,
  lowRate: 0.26,
  highRate: 0.28,
  // The 28% rate applies to AMT income over this, after the exemption.
  highRateFrom: {
    single: $(244_500),
    married_joint: $(244_500),
    married_separate: $(122_250),
    head_of_household: $(244_500),
  },
} as const;

// RSUs: employers withhold a flat rate on vests ("supplemental wages"): 22% up to $1
// million of supplemental wages in the year, 37% above. The real rate can be higher.
export const RSU_WITHHOLDING = {
  flatRate: 0.22,
  highRate: 0.37,
  highFromCents: $(1_000_000),
} as const;

// Crypto: property, so a sale is a gain or loss; long-term after more than a year.
export const CRYPTO_TAX = { longTermDays: 365 } as const;

// A "set aside" is only offered when the tax it covers is at least this much.
export const EQUITY_SET_ASIDE_MIN_CENTS = 20_000;

export const EQUITY_EVENT_KINDS = {
  rsu: "RSUs vested",
  espp: "ESPP shares sold",
  iso: "ISOs exercised",
} as const;
export type EquityEventKind = keyof typeof EQUITY_EVENT_KINDS;
