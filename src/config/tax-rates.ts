import type { FilingStatus } from "@/config/tax";
import { federalParams } from "@/config/tax-params";
import type { Bracket } from "@/config/tax-params/types";

// Tax figures for Jane's estimates (spec step 120 on). Since Tax T1 the federal figures live in
// src/config/tax-params/us-2026.ts, each with the page it was read at, the day it was read and
// whether it is confirmed; this file re-exports them under the names the rest of the app already
// uses (until T4 moves the callers to the year-keyed parameters), and keeps the state schedules.
// FOR REVIEW: every figure should be checked by someone qualified before it's relied on, and
// again each year. Where a 2026 state figure wasn't published or couldn't be confirmed, it's
// marked ESTIMATE TO VERIFY.
//
// All money is in cents; rates are fractions.

export const TAX_RATES_YEAR = 2026;

// A bracket: the rate applies to income over `over` (cents), up to the next bracket.
export type { Bracket };

const $ = (dollars: number) => Math.round(dollars * 100);

const US = federalParams(TAX_RATES_YEAR);

export const FEDERAL_BRACKETS: Readonly<Record<FilingStatus, readonly Bracket[]>> =
  US.brackets.value;
export const STANDARD_DEDUCTION: Readonly<Record<FilingStatus, number>> =
  US.standardDeduction.value;
// The additional standard deduction for each person 65 or older (or blind): unmarried, and each
// spouse of a married couple. Spec step 269 uses it to judge whether itemizing medical costs beats
// the standard deduction for a retiree.
export const ADDITIONAL_STANDARD_65 = US.additionalStandard.value;
// Long-term gains and qualified dividends: 0% up to the first figure of taxable income, 15% up to
// the second, 20% above. Married separately: half of joint.
export const CAPITAL_GAINS_BRACKETS: Readonly<Record<FilingStatus, readonly Bracket[]>> =
  US.capitalGains.value;

// Spec step 124: a net capital loss comes off other income up to this much a year (the rest
// carries forward); wash sales look this many days either side of a sale at a loss.
export const CAPITAL_LOSS_LIMIT = US.capitalLoss.value;
export const WASH_SALE_DAYS = 30;
// Gains on shares held longer than this many days are long-term.
export const LONG_TERM_DAYS = 365;

// Child tax credit (OBBBA, permanent): per qualifying child under 17, up to the refundable part
// from 15% of earned income over $2,500; less $50 per $1,000 (or part) of income over the
// threshold. Other dependants: $500, not refundable.
export const CHILD_TAX_CREDIT = US.ctc.value;

// Earned income tax credit, by qualifying children (0, 1, 2, 3+): the credit rises at the phase-in
// rate up to the maximum, then falls at the phase-out rate past the threshold. Married filing
// separately can claim it only in narrow cases, so Jane doesn't count it. Without a qualifying
// child the credit needs the filer to be 25 to 64 at the end of the year (IRC 32(c)(1)(A)(ii)(II));
// a student under 25 can't claim it (overnight upload QA).
export const EITC = US.eitc.value;

// Self-employment tax: 92.35% of net earnings, 12.4% Social Security up to the wage base (less W-2
// Social Security wages) and 2.9% Medicare; half is deducted from income. Below the minimum net
// earnings, no self-employment tax.
export const SELF_EMPLOYMENT_TAX = US.selfEmployment.value;

// Employee payroll tax, for checking pay stubs and the demo's stand-in stubs.
export const PAYROLL_TAX = US.payroll.value;

// 0.9% on wages and self-employment income over the threshold (not indexed).
export const ADDITIONAL_MEDICARE = US.additionalMedicare.value;

// 3.8% on investment income over the threshold of modified AGI (not indexed).
export const NET_INVESTMENT_INCOME_TAX = US.netInvestmentIncomeTax.value;

// Qualified business income deduction: 20%, counted only below the threshold where its limits start
// (Jane doesn't work out the limits above it). Rev. Proc. 2025-32 section 4.26: the threshold isn't
// the 32% bracket's edge (connectors roadmap round 16 found the old figures were).
export const QBI = US.qbi.value;

// The One Big Beautiful Bill Act's deductions for tax years 2025 through 2028, taken whether or not
// the person itemizes (connectors roadmap round 16). Tips, overtime and the senior deduction need a
// joint return when married. Each is cut as modified AGI passes its line: tips and overtime by
// $100, car-loan interest by $200, for each $1,000 over; the senior deduction by 6% of what's over,
// for each person who's 65 or older.
export const OBBBA_DEDUCTIONS = US.obbba.value;

// The Saver's Credit's last year (from 2027 the Saver's Match replaces it): a nonrefundable credit
// (Form 8880) on IRA and workplace-plan money put in for 2026, for anyone 18 or older who isn't a
// full-time student or someone's dependent, with AGI at or under the limit. The credit is 50%, 20%
// or 10% of up to $2,000 each; the tier lines are in the notice (Notice 2025-67) but the estimate
// only says the 10% everyone under the limit gets. IRA money counts until the filing deadline.
export const SAVERS_CREDIT = US.savers.value;

// The Saver's Match from 2027 (IRS Notice 2026-48, proposed rules, not final): a federal match of
// 50% of up to $2,000 each, phased out over these incomes, paid only into a traditional IRA or a
// workplace plan that accepts it, never into a Roth IRA. Shown labelled "proposed" until the rules
// are final.
export const SAVERS_MATCH = US.saversMatch.value;

// Catch-up contributions must go to Roth for anyone whose FICA wages the year before were over this
// (SECURE 2.0; final regulations T.D. 10033 apply from 2027, good-faith use in 2026). The figure is
// marked WRONG TODAY in us-2026.ts: $150,000 is the threshold for 2026 catch-ups, the one for 2027
// ones is $155,000 (Notice 2026-66; us-2026.ts holds both). Nothing in the app reads this yet
// (catchUpMustBeRoth is tested only), and an existing test pins $150,000, so it is left.
export const ROTH_CATCH_UP = {
  priorYearFicaWagesOver: US.rothCatchUp.value.priorYearFicaWagesOver,
  requiredFrom: US.rothCatchUp.value.requiredFrom,
  rule: US.rothCatchUp.value.rule,
} as const;

// Student loan interest: up to $2,500, phased out over the range of modified AGI; not for married
// filing separately.
export const STUDENT_LOAN_INTEREST = US.studentLoanInterest.value;

// Itemized deductions (OBBBA): state and local taxes up to the cap, cut by 30% of income over the
// threshold but never below the floor; gifts to charity above 0.5% of AGI; medical costs above 7.5%
// of AGI. Non-itemizers can deduct cash gifts up to the limit.
export const ITEMIZED = {
  saltCap: US.salt.value.cap,
  saltPhaseDownFrom: US.salt.value.phaseDownFrom,
  saltPhaseDownRate: US.salt.value.phaseDownRate,
  saltFloor: US.salt.value.floor,
  charityFloorShare: US.charity.value.floorShare,
  medicalFloorShare: US.medical.value.floorShare,
  nonItemizerCharity: US.charity.value.nonItemizer,
} as const;

// Contribution limits for 2026.
export const CONTRIBUTION_LIMITS = US.contributionLimits.value;

// Child and dependent care credit (OBBBA, from 2026): a share of up to $3,000 of costs for one
// child, $6,000 for two or more. The share starts at 50% and steps down to 35% from $15,000 of AGI
// (1 point per $2,000), then from 35% to 20% above $75,000 ($150,000 joint), 1 point per $2,000
// ($4,000 joint) (26 USC 21(a)(2)).
export const DEPENDENT_CARE_CREDIT = US.dependentCare.value;

// Education credits: American Opportunity (100% of the first $2,000, 25% of the next $2,000; 40%
// refundable) and Lifetime Learning (20% of up to $10,000), phased out over the modified AGI
// ranges.
export const EDUCATION_CREDITS = US.education.value;

// The 2025 home energy credits, still claimable on 2025 returns for property placed in service in
// 2025: 30% of costs; improvements (25C) capped at $1,200 a year, $2,000 for heat pumps; solar and
// batteries (25D) uncapped.
export const ENERGY_CREDITS_2025 = {
  rate: US.energy.value.rate,
  improvementCap: US.energy.value.improvementCap,
  heatPumpCap: US.energy.value.heatPumpCap,
} as const;

// The home energy credits (25C, 25D) ended for property placed in service after Dec 31, 2025, and
// the clean vehicle credits for vehicles acquired after Sep 30, 2025 (OBBBA).
export const ENERGY_CREDITS_END = {
  home: US.energy.value.homeEnds,
  vehicle: US.energy.value.vehicleEnds,
} as const;

// Standard mileage rate for business driving in 2026: 72.5 cents (IRS Notice 2026-10).
export const MILEAGE_RATE_CENTS = US.mileage.value.businessCentsPerMile;
// The miles Jane holds are a year's total with no dates, so it can't split them: the IRS rate is 72.5
// cents to June 30 and 76 cents from July 1, 2026 (us-2026.ts holds both and marks this WRONG TODAY
// for July to December). Every mile is counted at 72.5, and this says so wherever the figure shows.
export const MILEAGE_RATE_NOTE =
  "Every mile is counted at one rate; if the IRS changes its rate partway through the year, miles after the change are worth a little more than this shows.";

// Home office, simplified method: $5 a square foot, up to 300 square feet.
export const HOME_OFFICE_SIMPLIFIED = US.homeOffice.value;

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
// `deduction` is the part of income taxed at nothing (Mississippi's first $10,000), taken off first.
const FLAT = (rate: number, source: string, estimate?: true, deduction = 0): StateTax => ({
  kind: "flat",
  rate,
  deduction,
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
  // The first $10,000 isn't taxed (the zero band, as this entry has always said); Mississippi's own
  // standard deduction and exemptions are not counted, so this is an estimate.
  MS: FLAT(
    0.04,
    "Mississippi 4% for 2026 on income over $10,000 (its own standard deduction and exemptions aren't counted).",
    true,
    $(10_000),
  ),
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
    // FOR REVIEW at the NY IT-201 instructions (2025 tax rate schedule): head of household has its
    // own schedule (a finding, CodeRabbit sweep 1c cfg-03 #2, says it's 5.25% at $20,000 taxable,
    // where the single one is 5.5%). It isn't entered, so head of household uses the single
    // schedule and the source below says so.
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
      "New York State Department of Taxation and Finance, 2025 figures (city taxes not included; head of household is worked out on the single schedule, which can be a little high).",
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
