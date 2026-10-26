// Taxes on retirement income (spec step 271). FOR REVIEW: thresholds by year, with sources.
//
// Sources: IRC section 86 and IRS Publication 915 (how much Social Security is taxable: the base
// amounts are set in law and not indexed); CMS, "2026 Medicare Parts A & B premiums and
// deductibles" and the Social Security Administration's "Premiums: rules for higher-income
// beneficiaries" (POMS HI 01101.020) for the income-related monthly adjustment amounts (IRMAA),
// which use the modified adjusted gross income from two years before; IRS Form W-4V (voluntary
// withholding from Social Security at 7%, 10%, 12% or 22%). ESTIMATE TO VERIFY each year; years
// past the latest published are estimated by indexing, and say so.

const $ = (d: number) => Math.round(d * 100);

// Social Security is taxable once "provisional income" (other income, tax-exempt interest and half
// the benefits) passes the first base amount: up to 50% of benefits, then up to 85% past the
// second.
export const SS_BASE = {
  single: [$(25_000), $(34_000)],
  married_joint: [$(32_000), $(44_000)],
} as const;
export const SS_SHARES = { first: 0.5, second: 0.85 } as const;

// Medicare's income-related surcharges (IRMAA), by the year the premiums are paid. Each tier
// starts above `over` (modified adjusted gross income from two years before); the surcharge is
// monthly, per person on Medicare, for Part B and for Part D.
export type IrmaaYear = {
  single: readonly number[];
  joint: readonly number[];
  partB: readonly number[];
  partD: readonly number[];
  estimated: boolean;
  source: string;
};
export const IRMAA: Readonly<Record<number, IrmaaYear>> = {
  2025: {
    single: [$(106_000), $(133_000), $(167_000), $(200_000), $(500_000)],
    joint: [$(212_000), $(266_000), $(334_000), $(400_000), $(750_000)],
    partB: [$(74), $(185), $(295.9), $(406.9), $(443.9)],
    partD: [$(13.7), $(35.3), $(57), $(78.6), $(85.8)],
    estimated: false,
    source: "CMS 2025 Medicare premiums; SSA POMS HI 01101.020",
  },
  2026: {
    single: [$(109_000), $(137_000), $(171_000), $(205_000), $(500_000)],
    joint: [$(218_000), $(274_000), $(342_000), $(410_000), $(750_000)],
    partB: [$(81.2), $(202.9), $(324.6), $(446.3), $(487)],
    partD: [$(14.5), $(37.5), $(60.4), $(83.3), $(91)],
    estimated: false,
    source: "CMS 2026 Medicare premiums; SSA POMS HI 01101.020",
  },
};
// Years past the latest published: its thresholds and surcharges grown by this much a year
// (thresholds are indexed to inflation; the top tiers are fixed in law until indexed).
export const IRMAA_INDEX = 0.025;
// How far ahead the premiums are set: the income of year Y sets year Y + 2's premiums.
export const IRMAA_LOOKBACK_YEARS = 2;

// Who is shown the surcharge line: near Medicare or on it, with pre-tax savings that withdrawals
// or conversions could push over it. Raised when the room to the first tier is less than this
// share of their pre-tax savings.
export const IRMAA_WATCH = { fromAge: 63, minPreTaxCents: $(100_000), roomShare: 0.2 } as const;

// Words that find Social Security deposits and IRA withdrawals in a bank's descriptions (the
// patterns below then decide which is which).
export const RETIREMENT_DEPOSIT_WORDS = ["SSA", "SOC SEC", "SOCIAL SECURITY", "IRA DIST", "RMD"];
// Social Security deposits.
export const SOCIAL_SECURITY_PAYEE = /\bSSA\b|SOC SEC|SOCIAL SECURITY/i;
// Withdrawals from a traditional IRA that land in the person's accounts.
export const IRA_DISTRIBUTION = /IRA DISTRIBUTION|IRA DIST\b|RMD\b/i;

// Raising the Social Security withholding: when the tax on the taxable part is at least this.
export const SS_TAX_MIN_CENTS = $(300);

// Medicare sign-up (detector coverage, spec step 254). FOR REVIEW each year. Sources: CMS, "2026
// Medicare Parts A & B premiums and deductibles" (the standard Part B premium); Medicare.gov,
// "Avoid late enrollment penalties" (10% of the standard premium for each full 12 months late,
// for as long as you have Part B; the initial window is the 7 months around the 65th birthday;
// work cover from an employer with 20 or more employees lets Part B wait without the penalty).
export const MEDICARE = {
  startAge: 65,
  partBMonthlyCents: { 2025: $(185), 2026: $(202.9) } as Readonly<Record<number, number>>,
  latePenaltyPerYear: 0.1,
  windowMonths: 7,
  employerSizeToWait: 20,
  // Brought "soon" from this told age; before it, "later".
  soonFromAge: 64,
} as const;

// Social Security claiming age (detector coverage). FOR REVIEW each year. Sources: SSA, "Primary
// insurance amount" (the 2026 bend points, $1,286 and $7,749 of average indexed monthly
// earnings, at 90%, 32% and 15%); SSA "Contribution and benefit base" (2026: $184,500); SSA
// "Delayed retirement credits" (8% a year past full retirement age, 67 for anyone born in 1960
// or later, up to 70). The benefit is estimated from today's pay, not the person's record:
// their Social Security statement has the real figure.
export const SOCIAL_SECURITY = {
  bendPointsCents: [$(1_286), $(7_749)] as const,
  bendShares: [0.9, 0.32, 0.15] as const,
  taxableMaxCents: $(184_500),
  fullAge: 67,
  latestAge: 70,
  delayCreditPerYear: 0.08,
  // Brought from this told age, or to anyone whose life stage is approaching retirement.
  fromAge: 55,
  soonFromAge: 61,
} as const;
