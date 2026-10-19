import type { FilingStatus } from "@/config/tax";

// Tax figures for Jane's estimates (spec step 120 on). FOR REVIEW: every figure here should be
// checked by someone qualified before it's relied on, and again each year.
//
// Sources:
// - IRS Rev. Proc. 2025-32 (tax year 2026 inflation adjustments, including the One Big
//   Beautiful Bill Act's changes) and the IRS news release on it: brackets, standard
//   deduction, child tax credit, EITC, AMT, capital gains thresholds, health FSA.
// - IRS news releases for 2026 retirement plan limits (401(k) $24,500, IRA $7,500) and
//   HSA limits (Rev. Proc. 2025-19).
// - SSA: 2026 Social Security wage base ($184,500).
// - One Big Beautiful Bill Act (P.L. 119-21): SALT cap ($40,400 for 2026), charitable
//   deduction for non-itemizers ($1,000 / $2,000), the 0.5% floor on itemized gifts,
//   dependent care FSA ($7,500), the end of the home energy credits after 2025.
// - State figures: each state's revenue department; see each entry. Where a 2026 figure
//   wasn't published or couldn't be confirmed, it's marked ESTIMATE TO VERIFY.
//
// All money is in cents; rates are fractions.

export const TAX_RATES_YEAR = 2026;

// A bracket: the rate applies to income over `over` (cents), up to the next bracket.
export type Bracket = { over: number; rate: number };

const $ = (dollars: number) => Math.round(dollars * 100);

// Rev. Proc. 2025-32 §4.01, Tables 1–4. Head of household: sources disagree on where the
// 24% and 32% brackets end ($201,750 / $256,200 here, $201,775 / $256,225 in some
// summaries). ESTIMATE TO VERIFY against the Rev. Proc. itself.
export const FEDERAL_BRACKETS: Readonly<Record<FilingStatus, readonly Bracket[]>> = {
  single: [
    { over: 0, rate: 0.1 },
    { over: $(12_400), rate: 0.12 },
    { over: $(50_400), rate: 0.22 },
    { over: $(105_700), rate: 0.24 },
    { over: $(201_775), rate: 0.32 },
    { over: $(256_225), rate: 0.35 },
    { over: $(640_600), rate: 0.37 },
  ],
  married_joint: [
    { over: 0, rate: 0.1 },
    { over: $(24_800), rate: 0.12 },
    { over: $(100_800), rate: 0.22 },
    { over: $(211_400), rate: 0.24 },
    { over: $(403_550), rate: 0.32 },
    { over: $(512_450), rate: 0.35 },
    { over: $(768_700), rate: 0.37 },
  ],
  married_separate: [
    { over: 0, rate: 0.1 },
    { over: $(12_400), rate: 0.12 },
    { over: $(50_400), rate: 0.22 },
    { over: $(105_700), rate: 0.24 },
    { over: $(201_775), rate: 0.32 },
    { over: $(256_225), rate: 0.35 },
    { over: $(384_350), rate: 0.37 },
  ],
  head_of_household: [
    { over: 0, rate: 0.1 },
    { over: $(17_700), rate: 0.12 },
    { over: $(67_450), rate: 0.22 },
    { over: $(105_700), rate: 0.24 },
    { over: $(201_750), rate: 0.32 },
    { over: $(256_200), rate: 0.35 },
    { over: $(640_600), rate: 0.37 },
  ],
};

export const STANDARD_DEDUCTION: Readonly<Record<FilingStatus, number>> = {
  single: $(16_100),
  married_joint: $(32_200),
  married_separate: $(16_100),
  head_of_household: $(24_150),
};

// Long-term gains and qualified dividends: 0% up to the first figure of taxable income, 15%
// up to the second, 20% above (Rev. Proc. 2025-32). Married separately: half of joint.
export const CAPITAL_GAINS_BRACKETS: Readonly<Record<FilingStatus, readonly Bracket[]>> = {
  single: [
    { over: 0, rate: 0 },
    { over: $(49_450), rate: 0.15 },
    { over: $(545_500), rate: 0.2 },
  ],
  married_joint: [
    { over: 0, rate: 0 },
    { over: $(98_900), rate: 0.15 },
    { over: $(613_700), rate: 0.2 },
  ],
  married_separate: [
    { over: 0, rate: 0 },
    { over: $(49_450), rate: 0.15 },
    { over: $(306_850), rate: 0.2 },
  ],
  head_of_household: [
    { over: 0, rate: 0 },
    { over: $(66_200), rate: 0.15 },
    { over: $(579_600), rate: 0.2 },
  ],
};

// Spec step 124: a net capital loss comes off other income up to this much a year (the rest
// carries forward); wash sales look this many days either side of a sale at a loss.
export const CAPITAL_LOSS_LIMIT = { normal: $(3_000), marriedSeparate: $(1_500) } as const;
export const WASH_SALE_DAYS = 30;
// Gains on shares held longer than this many days are long-term.
export const LONG_TERM_DAYS = 365;

// Child tax credit (OBBBA, permanent): per qualifying child under 17, up to the refundable
// part from 15% of earned income over $2,500; less $50 per $1,000 (or part) of income over
// the threshold. Other dependants: $500, not refundable.
export const CHILD_TAX_CREDIT = {
  perChild: $(2_200),
  refundablePerChild: $(1_700),
  earnedIncomeFloor: $(2_500),
  refundableRate: 0.15,
  otherDependant: $(500),
  phaseOutStep: $(1_000),
  phaseOutPerStep: $(50),
  phaseOutFrom: {
    single: $(200_000),
    married_joint: $(400_000),
    married_separate: $(200_000),
    head_of_household: $(200_000),
  } satisfies Record<FilingStatus, number>,
} as const;

// Earned income tax credit, by qualifying children (0, 1, 2, 3+): the credit rises at the
// phase-in rate up to the maximum, then falls at the phase-out rate past the threshold.
// Married filing separately can claim it only in narrow cases, so Jane doesn't count it.
// The investment income limit for 2026 is ESTIMATE TO VERIFY ($11,950 for 2025, indexed).
export const EITC = {
  maxCredit: [$(664), $(4_427), $(7_316), $(8_231)],
  phaseInRate: [0.0765, 0.34, 0.4, 0.45],
  phaseOutRate: [0.0765, 0.1598, 0.2106, 0.2106],
  phaseOutFrom: {
    single: [$(10_860), $(23_890), $(23_890), $(23_890)],
    married_joint: [$(18_140), $(31_160), $(31_160), $(31_160)],
  },
  investmentIncomeLimit: $(12_200),
} as const;

// Self-employment tax: 92.35% of net earnings, 12.4% Social Security up to the wage base
// (less W-2 Social Security wages) and 2.9% Medicare; half is deducted from income.
export const SELF_EMPLOYMENT_TAX = {
  netEarningsShare: 0.9235,
  socialSecurityRate: 0.124,
  medicareRate: 0.029,
  wageBase: $(184_500),
  // Below this much net earnings, no self-employment tax.
  minimumNetEarnings: $(400),
} as const;

// Employee payroll tax, for checking pay stubs and the demo's stand-in stubs.
export const PAYROLL_TAX = { socialSecurityRate: 0.062, medicareRate: 0.0145 } as const;

// 0.9% on wages and self-employment income over the threshold (not indexed).
export const ADDITIONAL_MEDICARE = {
  rate: 0.009,
  threshold: {
    single: $(200_000),
    married_joint: $(250_000),
    married_separate: $(125_000),
    head_of_household: $(200_000),
  } satisfies Record<FilingStatus, number>,
} as const;

// 3.8% on investment income over the threshold of modified AGI (not indexed).
export const NET_INVESTMENT_INCOME_TAX = {
  rate: 0.038,
  threshold: ADDITIONAL_MEDICARE.threshold,
} as const;

// Qualified business income deduction: 20%, counted only below the threshold where its
// limits start (Jane doesn't work out the limits above it).
export const QBI = {
  rate: 0.2,
  threshold: {
    single: $(201_775),
    married_joint: $(403_550),
    married_separate: $(201_775),
    head_of_household: $(201_775),
  } satisfies Record<FilingStatus, number>,
} as const;

// Student loan interest: up to $2,500, phased out over the range of modified AGI; not for
// married filing separately.
export const STUDENT_LOAN_INTEREST = {
  max: $(2_500),
  phaseOut: {
    single: [$(85_000), $(100_000)],
    married_joint: [$(175_000), $(205_000)],
    married_separate: null,
    head_of_household: [$(85_000), $(100_000)],
  } satisfies Record<FilingStatus, [number, number] | null>,
} as const;

// Itemized deductions (OBBBA): state and local taxes up to the cap, cut by 30% of income
// over the threshold but never below the floor; gifts to charity above 0.5% of AGI; medical
// costs above 7.5% of AGI. Non-itemizers can deduct cash gifts up to the limit.
export const ITEMIZED = {
  saltCap: { normal: $(40_400), marriedSeparate: $(20_200) },
  saltPhaseDownFrom: { normal: $(505_000), marriedSeparate: $(252_500) },
  saltPhaseDownRate: 0.3,
  saltFloor: { normal: $(10_000), marriedSeparate: $(5_000) },
  charityFloorShare: 0.005,
  medicalFloorShare: 0.075,
  nonItemizerCharity: { normal: $(1_000), marriedJoint: $(2_000) },
} as const;

// Contribution limits for 2026.
export const CONTRIBUTION_LIMITS = {
  // 401(k), 403(b), most 457 plans: employee deferrals.
  workplace: $(24_500),
  workplaceCatchUp50: $(8_000),
  workplaceCatchUp60to63: $(11_250),
  ira: $(7_500),
  iraCatchUp50: $(1_100),
  hsaSelf: $(4_400),
  hsaFamily: $(8_750),
  hsaCatchUp55: $(1_000),
  healthFsa: $(3_400),
  dependentCareFsa: $(7_500),
  dependentCareFsaMarriedSeparate: $(3_750),
} as const;

// Child and dependent care credit (OBBBA, from 2026): a share of up to $3,000 of costs for
// one child, $6,000 for two or more. The share starts at 50% and steps down to 35% from
// $15,000 of AGI (1 point per $2,000), then from 35% to 20% above $75,000 ($150,000 joint),
// 1 point per $2,000 ($4,000 joint). ESTIMATE TO VERIFY the step-down details.
export const DEPENDENT_CARE_CREDIT = {
  costLimit: [$(3_000), $(6_000)],
  topShare: 0.5,
  middleShare: 0.35,
  bottomShare: 0.2,
  firstStepFrom: $(15_000),
  secondStepFrom: { normal: $(75_000), marriedJoint: $(150_000) },
  stepSize: { normal: $(2_000), marriedJoint: $(4_000) },
} as const;

// Education credits: American Opportunity (100% of the first $2,000, 25% of the next
// $2,000; 40% refundable) and Lifetime Learning (20% of up to $10,000), phased out over the
// modified AGI ranges (Rev. Proc. 2025-32; AOTC range is fixed in law).
export const EDUCATION_CREDITS = {
  aotcMax: $(2_500),
  llcRate: 0.2,
  llcCostLimit: $(10_000),
  phaseOut: {
    single: [$(80_000), $(90_000)],
    married_joint: [$(160_000), $(180_000)],
  },
} as const;

// The 2025 home energy credits, still claimable on 2025 returns for property placed in
// service in 2025: 30% of costs; improvements (25C) capped at $1,200 a year, $2,000 for heat
// pumps; solar and batteries (25D) uncapped.
export const ENERGY_CREDITS_2025 = {
  rate: 0.3,
  improvementCap: $(1_200),
  heatPumpCap: $(2_000),
} as const;

// The home energy credits (25C, 25D) ended for property placed in service after Dec 31,
// 2025, and the clean vehicle credits for vehicles acquired after Sep 30, 2025 (OBBBA).
export const ENERGY_CREDITS_END = { home: "2025-12-31", vehicle: "2025-09-30" } as const;

// Estimated tax: no penalty when withholding and estimated payments cover 90% of this
// year's tax, or 100% of last year's (110% when last year's AGI was over $150,000), or
// when what's owed is under $1,000.
export const ESTIMATED_TAX_SAFE_HARBOR = {
  thisYearShare: 0.9,
  lastYearShare: 1.0,
  lastYearShareHighIncome: 1.1,
  highIncomeAgi: $(150_000),
  smallBalance: $(1_000),
} as const;

// Standard mileage rate for business driving in 2026: 72.5 cents (IRS Notice 2026-10).
// Some later sources report a mid-year rise to 76 cents from July 1, 2026: ESTIMATE TO
// VERIFY; Jane uses 72.5.
export const MILEAGE_RATE_CENTS = 72.5;

// Home office, simplified method: $5 a square foot, up to 300 square feet.
export const HOME_OFFICE_SIMPLIFIED = { perSquareFoot: $(5), maxSquareFeet: 300 } as const;

// State income tax.
// - none: no tax on wages.
// - flat: one rate on federal AGI less the state's standard deduction (a simplification).
// - brackets: the state's own schedule.
// - approximate: Jane doesn't have this state's schedule yet; a rough rate, clearly marked.
export type StateTax =
  | { kind: "none"; source: string }
  | { kind: "flat"; rate: number; deduction: number; source: string; estimate?: true }
  | {
      kind: "brackets";
      brackets: Readonly<Record<FilingStatus, readonly Bracket[]>>;
      deduction: Readonly<Record<FilingStatus, number>>;
      // Credits per person and per dependant, taken off the tax.
      personalCredit: Readonly<Record<FilingStatus, number>>;
      dependantCredit: number;
      source: string;
      estimate?: true;
    }
  | { kind: "approximate"; rate: number; source: string };

const NONE = (source: string): StateTax => ({ kind: "none", source });
const FLAT = (rate: number, source: string, estimate?: true): StateTax => ({
  kind: "flat",
  rate,
  deduction: 0,
  source,
  ...(estimate ? { estimate } : {}),
});
// A rough rate for states whose schedules aren't in here yet.
const ROUGH = (rate: number): StateTax => ({
  kind: "approximate",
  rate,
  source: "A rough average rate; this state's own brackets aren't in Jane yet.",
});

const doubled = (brackets: readonly Bracket[]) =>
  brackets.map((b) => ({ over: b.over * 2, rate: b.rate }));

// California: 2025 schedules from the Franchise Tax Board (2026 indexing not yet confirmed,
// ESTIMATE TO VERIFY), plus 1% mental health services tax over $1,000,000.
const CA_SINGLE: readonly Bracket[] = [
  { over: 0, rate: 0.01 },
  { over: $(11_079), rate: 0.02 },
  { over: $(26_264), rate: 0.04 },
  { over: $(41_452), rate: 0.06 },
  { over: $(57_542), rate: 0.08 },
  { over: $(72_724), rate: 0.093 },
  { over: $(371_479), rate: 0.103 },
  { over: $(445_771), rate: 0.113 },
  { over: $(742_953), rate: 0.123 },
  { over: $(1_000_000), rate: 0.133 },
];
const CA_HEAD: readonly Bracket[] = [
  { over: 0, rate: 0.01 },
  { over: $(22_173), rate: 0.02 },
  { over: $(52_530), rate: 0.04 },
  { over: $(67_716), rate: 0.06 },
  { over: $(83_805), rate: 0.08 },
  { over: $(98_990), rate: 0.093 },
  { over: $(505_208), rate: 0.103 },
  { over: $(606_251), rate: 0.113 },
  // 11.3% plus the 1% over $1,000,000, then 12.3% plus 1%.
  { over: $(1_000_000), rate: 0.123 },
  { over: $(1_010_417), rate: 0.133 },
];
const CA_JOINT: readonly Bracket[] = [
  ...doubled(CA_SINGLE.slice(0, 8)),
  { over: $(1_000_000), rate: 0.123 },
  { over: $(1_485_906), rate: 0.133 },
];

// New York: 2025 schedules from the Department of Taxation and Finance (2026's lower rates
// for the first brackets not yet confirmed here, ESTIMATE TO VERIFY).
const NY_SINGLE: readonly Bracket[] = [
  { over: 0, rate: 0.04 },
  { over: $(8_500), rate: 0.045 },
  { over: $(11_700), rate: 0.0525 },
  { over: $(13_900), rate: 0.055 },
  { over: $(80_650), rate: 0.06 },
  { over: $(215_400), rate: 0.0685 },
  { over: $(1_077_550), rate: 0.0965 },
  { over: $(5_000_000), rate: 0.103 },
  { over: $(25_000_000), rate: 0.109 },
];
const NY_JOINT: readonly Bracket[] = [
  { over: 0, rate: 0.04 },
  { over: $(17_150), rate: 0.045 },
  { over: $(23_600), rate: 0.0525 },
  { over: $(27_900), rate: 0.055 },
  { over: $(161_550), rate: 0.06 },
  { over: $(323_200), rate: 0.0685 },
  { over: $(2_155_350), rate: 0.0965 },
  { over: $(5_000_000), rate: 0.103 },
  { over: $(25_000_000), rate: 0.109 },
];

export const STATE_TAX: Readonly<Record<string, StateTax>> = {
  AK: NONE("Alaska has no income tax."),
  FL: NONE("Florida has no income tax."),
  NV: NONE("Nevada has no income tax."),
  NH: NONE("New Hampshire doesn't tax wages (its interest and dividends tax ended in 2025)."),
  SD: NONE("South Dakota has no income tax."),
  TN: NONE("Tennessee has no income tax."),
  TX: NONE("Texas has no income tax."),
  WA: NONE("Washington doesn't tax wages (it taxes some capital gains)."),
  WY: NONE("Wyoming has no income tax."),
  AZ: FLAT(0.025, "Arizona flat rate, 2.5%."),
  CO: FLAT(0.044, "Colorado flat rate, 4.4%.", true),
  GA: FLAT(0.0519, "Georgia flat rate, 5.19% for 2025; 2026 may be lower.", true),
  ID: FLAT(0.053, "Idaho flat rate, 5.3%.", true),
  IL: FLAT(0.0495, "Illinois flat rate, 4.95%."),
  IN: FLAT(0.0295, "Indiana flat rate, 2.95% for 2026 (county taxes not included)."),
  IA: FLAT(0.038, "Iowa flat rate, 3.8%."),
  KY: FLAT(0.035, "Kentucky flat rate, 3.5% for 2026."),
  LA: FLAT(0.03, "Louisiana flat rate, 3%."),
  MA: FLAT(0.05, "Massachusetts 5% (plus 4% on income over about $1 million)."),
  MI: FLAT(0.0425, "Michigan flat rate, 4.25% (city taxes not included)."),
  MS: FLAT(0.04, "Mississippi 4% for 2026 on income over $10,000.", true),
  NC: FLAT(0.0399, "North Carolina flat rate, 3.99% for 2026."),
  PA: FLAT(0.0307, "Pennsylvania flat rate, 3.07% (local taxes not included)."),
  UT: FLAT(0.045, "Utah flat rate, 4.5%.", true),
  CA: {
    kind: "brackets",
    brackets: {
      single: CA_SINGLE,
      married_separate: CA_SINGLE,
      married_joint: CA_JOINT,
      head_of_household: CA_HEAD,
    },
    deduction: {
      single: $(5_706),
      married_separate: $(5_706),
      married_joint: $(11_412),
      head_of_household: $(11_412),
    },
    personalCredit: {
      single: $(153),
      married_separate: $(153),
      married_joint: $(306),
      head_of_household: $(153),
    },
    dependantCredit: $(475),
    source: "California Franchise Tax Board, 2025 figures (2026 not yet confirmed).",
    estimate: true,
  },
  NY: {
    kind: "brackets",
    brackets: {
      single: NY_SINGLE,
      married_separate: NY_SINGLE,
      married_joint: NY_JOINT,
      head_of_household: NY_SINGLE,
    },
    deduction: {
      single: $(8_000),
      married_separate: $(8_000),
      married_joint: $(16_050),
      head_of_household: $(11_200),
    },
    personalCredit: { single: 0, married_separate: 0, married_joint: 0, head_of_household: 0 },
    dependantCredit: 0,
    source:
      "New York State Department of Taxation and Finance, 2025 figures (city taxes not included).",
    estimate: true,
  },
  AL: ROUGH(0.045),
  AR: ROUGH(0.035),
  CT: ROUGH(0.05),
  DE: ROUGH(0.05),
  DC: ROUGH(0.06),
  HI: ROUGH(0.065),
  KS: ROUGH(0.05),
  ME: ROUGH(0.06),
  MD: ROUGH(0.05),
  MN: ROUGH(0.06),
  MO: ROUGH(0.045),
  MT: ROUGH(0.05),
  NE: ROUGH(0.045),
  NJ: ROUGH(0.045),
  NM: ROUGH(0.045),
  ND: ROUGH(0.015),
  OH: ROUGH(0.03),
  OK: ROUGH(0.045),
  OR: ROUGH(0.08),
  RI: ROUGH(0.045),
  SC: ROUGH(0.06),
  VT: ROUGH(0.06),
  VA: ROUGH(0.05),
  WV: ROUGH(0.045),
  WI: ROUGH(0.05),
};
