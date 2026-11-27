import type { Bracket, Cited, FederalParams, ParamStatus } from "./types";

// United States federal figures for tax year 2025 (Tax T3), in the same shape as us-2026.ts. Every
// figure was transcribed from the primary source named beside it (the IRS Revenue Procedure for the
// year's inflation adjustments, the 2025 forms and their instructions, the Code), read in full by
// the builder on the day below. Where a research note disagreed, the source won (see the pull
// request). All money is in cents; rates are fractions.
//
// Tax year 2025 is the year the One Big Beautiful Bill Act (Pub. L. 119-21) changed mid-year:
// Rev. Proc. 2024-40 (October 2024) has the 2025 inflation adjustments, and Rev. Proc. 2025-32
// replaced its standard deduction table. Where the two differ, the later one is used and said so.
//
// FOR REVIEW by someone qualified before it is relied on, and again each year.

const $ = (dollars: number) => Math.round(dollars * 100);

// The day the sources below were read for this file.
const READ = "2026-11-27";

const RP2440 = "https://www.irs.gov/pub/irs-drop/rp-24-40.pdf";
const RP2532 = "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf";
const RP2425 = "https://www.irs.gov/pub/irs-drop/rp-24-25.pdf";
const N2480 = "https://www.irs.gov/pub/irs-drop/n-24-80.pdf";
const N2505 = "https://www.irs.gov/pub/irs-drop/n-25-05.pdf";
const N2567 = "https://www.irs.gov/pub/irs-drop/n-25-67.pdf";
const N2648 = "https://www.irs.gov/pub/irs-drop/n-26-48.pdf";
const N2666 = "https://www.irs.gov/pub/irs-drop/n-26-66.pdf";
const RP1313 = "https://www.irs.gov/pub/irs-drop/rp-13-13.pdf";
const I1040 = "https://www.irs.gov/pub/irs-prior/i1040gi--2025.pdf";
const S1A = "https://www.irs.gov/pub/irs-prior/f1040s1a--2025.pdf";
const F8880 = "https://www.irs.gov/pub/irs-prior/f8880--2025.pdf";
const F2441 = "https://www.irs.gov/pub/irs-prior/f2441--2025.pdf";
const I2441 = "https://www.irs.gov/pub/irs-prior/i2441--2025.pdf";
const I8863 = "https://www.irs.gov/pub/irs-prior/i8863--2025.pdf";
const F1040SE = "https://www.irs.gov/pub/irs-prior/f1040sse--2025.pdf";
const I1040SE = "https://www.irs.gov/pub/irs-prior/i1040sse--2025.pdf";
const ENFAQ =
  "https://www.irs.gov/newsroom/faqs-for-modification-of-sections-25c-25d-25e-30c-30d-45l-45w-and-179d-under-public-law-119-21-139-stat-72-july-4-2025-commonly-known-as-the-one-big-beautiful-bill-obbb";
const code = (section: string) => `https://www.law.cornell.edu/uscode/text/26/${section}`;

const cited = <const T>(
  value: T,
  meta: {
    source: string;
    where: string;
    status?: ParamStatus;
    alsoSources?: readonly string[];
    verify?: string;
  },
): Cited<T> => ({
  value,
  source: meta.source,
  ...(meta.alsoSources ? { alsoSources: meta.alsoSources } : {}),
  where: meta.where,
  checkedOn: READ,
  status: meta.status ?? "verified",
  ...(meta.verify ? { verify: meta.verify } : {}),
});

const brackets = cited(
  {
    single: [
      { over: 0, rate: 0.1 },
      { over: $(11_925), rate: 0.12 },
      { over: $(48_475), rate: 0.22 },
      { over: $(103_350), rate: 0.24 },
      { over: $(197_300), rate: 0.32 },
      { over: $(250_525), rate: 0.35 },
      { over: $(626_350), rate: 0.37 },
    ],
    married_joint: [
      { over: 0, rate: 0.1 },
      { over: $(23_850), rate: 0.12 },
      { over: $(96_950), rate: 0.22 },
      { over: $(206_700), rate: 0.24 },
      { over: $(394_600), rate: 0.32 },
      { over: $(501_050), rate: 0.35 },
      { over: $(751_600), rate: 0.37 },
    ],
    married_separate: [
      { over: 0, rate: 0.1 },
      { over: $(11_925), rate: 0.12 },
      { over: $(48_475), rate: 0.22 },
      { over: $(103_350), rate: 0.24 },
      { over: $(197_300), rate: 0.32 },
      { over: $(250_525), rate: 0.35 },
      { over: $(375_800), rate: 0.37 },
    ],
    head_of_household: [
      { over: 0, rate: 0.1 },
      { over: $(17_000), rate: 0.12 },
      { over: $(64_850), rate: 0.22 },
      { over: $(103_350), rate: 0.24 },
      { over: $(197_300), rate: 0.32 },
      { over: $(250_500), rate: 0.35 },
      { over: $(626_350), rate: 0.37 },
    ],
  } satisfies Record<string, readonly Bracket[]>,
  {
    source: RP2440,
    alsoSources: [I1040],
    where:
      "Rev. Proc. 2024-40 section 2.01, Tables 1 to 4 (married joint, head of household, single, married separate); the 2025 Form 1040 instructions' Tax Table and Tax Computation Worksheet (Sections A to D) agree to the cent",
  },
);

const capitalGains = cited(
  {
    single: [
      { over: 0, rate: 0 },
      { over: $(48_350), rate: 0.15 },
      { over: $(533_400), rate: 0.2 },
    ],
    married_joint: [
      { over: 0, rate: 0 },
      { over: $(96_700), rate: 0.15 },
      { over: $(600_050), rate: 0.2 },
    ],
    married_separate: [
      { over: 0, rate: 0 },
      { over: $(48_350), rate: 0.15 },
      { over: $(300_000), rate: 0.2 },
    ],
    head_of_household: [
      { over: 0, rate: 0 },
      { over: $(64_750), rate: 0.15 },
      { over: $(566_700), rate: 0.2 },
    ],
  } satisfies Record<string, readonly Bracket[]>,
  {
    source: RP2440,
    where:
      "Rev. Proc. 2024-40 section 2.03: maximum zero rate amount and maximum 15 percent rate amount ($96,700 / $600,050 joint, $48,350 / $300,000 separate, $64,750 / $566,700 head of household, $48,350 / $533,400 all others)",
  },
);

export const US_2025: FederalParams = {
  year: 2025,
  brackets,
  capitalGains,
  standardDeduction: cited(
    {
      single: $(15_750),
      married_joint: $(31_500),
      married_separate: $(15_750),
      head_of_household: $(23_625),
    },
    {
      source: RP2532,
      alsoSources: [I1040],
      where:
        "Rev. Proc. 2025-32 section 3.01 (replaces section 2.15(1) of Rev. Proc. 2024-40, which had $15,000 / $30,000 / $22,500 before the 2025 law raised them); the 2025 Form 1040 instructions, Standard Deduction Chart",
    },
  ),
  additionalStandard: cited(
    { unmarried: $(2_000), married: $(1_600) },
    {
      source: RP2440,
      where:
        "Rev. Proc. 2024-40 section 2.15(3): $1,600 for the aged or blind, $2,000 if also unmarried and not a surviving spouse (not changed by Rev. Proc. 2025-32)",
    },
  ),
  capitalLoss: cited(
    { normal: $(3_000), marriedSeparate: $(1_500) },
    { source: code("1211"), where: "26 USC 1211(b)(1) (statute, not indexed)" },
  ),
  ctc: cited(
    {
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
      },
    },
    {
      source: RP2532,
      alsoSources: [RP2440, I1040, code("24")],
      where:
        "Rev. Proc. 2025-32 section 2.03 ($2,200 for any taxable year beginning in 2025); Rev. Proc. 2024-40 section 2.05 ($1,700 refundable); the 2025 Form 1040 instructions ($2,200 per child, of which $1,700 can be claimed for the ACTC); 26 USC 24(b)(1) ($50 for each $1,000 or fraction), 24(d)(1)(B) (15 percent over $2,500), 24(h)(3) ($200,000 / $400,000), 24(h)(4) ($500 other dependants)",
    },
  ),
  eitc: cited(
    {
      maxCredit: [$(649), $(4_328), $(7_152), $(8_046)],
      phaseInRate: [0.0765, 0.34, 0.4, 0.45],
      phaseOutRate: [0.0765, 0.1598, 0.2106, 0.2106],
      phaseOutFrom: {
        single: [$(10_620), $(23_350), $(23_350), $(23_350)],
        married_joint: [$(17_730), $(30_470), $(30_470), $(30_470)],
      },
      investmentIncomeLimit: $(11_950),
      childlessMinAge: 25,
      childlessMaxAge: 64,
    },
    {
      source: RP2440,
      alsoSources: [I1040, code("32")],
      where:
        "Rev. Proc. 2024-40 section 2.06(1) table (maximum credit, threshold phaseout amounts) and 2.06(2) (investment income over $11,950); 26 USC 32(b)(1) table (phase-in 7.65 / 34 / 40 / 45 and phase-out 7.65 / 15.98 / 21.06 / 21.06 percent); the 2025 Form 1040 instructions (age 25 to under 65 for filers without children; the EIC Table, which agrees at 10 sampled rows)",
    },
  ),
  selfEmployment: cited(
    {
      netEarningsShare: 0.9235,
      socialSecurityRate: 0.124,
      medicareRate: 0.029,
      wageBase: $(176_100),
      minimumNetEarnings: $(400),
    },
    {
      source: F1040SE,
      alsoSources: [I1040SE, code("1401")],
      where:
        "2025 Schedule SE line 7 ($176,100), line 4a (92.35%), the $400 floor on line 4c; the 2025 Schedule SE instructions ($176,100); 26 USC 1401 (12.4 and 2.9 percent)",
    },
  ),
  payroll: cited(
    { socialSecurityRate: 0.062, medicareRate: 0.0145 },
    { source: code("3101"), where: "26 USC 3101(a) 6.2 percent and (b)(1) 1.45 percent" },
  ),
  additionalMedicare: cited(
    {
      rate: 0.009,
      threshold: {
        single: $(200_000),
        married_joint: $(250_000),
        married_separate: $(125_000),
        head_of_household: $(200_000),
      },
    },
    {
      source: code("3101"),
      where:
        "26 USC 3101(b)(2): 0.9 percent over $250,000 joint, $125,000 separate (half of the joint figure), $200,000 other (not indexed)",
    },
  ),
  netInvestmentIncomeTax: cited(
    {
      rate: 0.038,
      threshold: {
        single: $(200_000),
        married_joint: $(250_000),
        married_separate: $(125_000),
        head_of_household: $(200_000),
      },
    },
    {
      source: code("1411"),
      where:
        "26 USC 1411(a)(1) 3.8 percent and (b): $250,000 joint, half of that separate, $200,000 other (not indexed)",
    },
  ),
  qbi: cited(
    {
      rate: 0.2,
      threshold: {
        single: $(197_300),
        married_joint: $(394_600),
        married_separate: $(197_300),
        head_of_household: $(197_300),
      },
    },
    {
      source: RP2440,
      where:
        "Rev. Proc. 2024-40 section 2.27: threshold $394,600 joint, $197,300 separate and all other returns (phase-in range ends $494,600 / $247,300). 20 percent: 26 USC 199A(a)",
    },
  ),
  obbba: cited(
    {
      firstYear: 2025,
      lastYear: 2028,
      tips: {
        max: { normal: $(25_000), marriedJoint: $(25_000) },
        phaseOutFrom: { normal: $(150_000), marriedJoint: $(300_000) },
        cutPerStep: $(100),
        joint: true,
        rule: "26 USC 224 (qualified tips)",
      },
      overtime: {
        max: { normal: $(12_500), marriedJoint: $(25_000) },
        phaseOutFrom: { normal: $(150_000), marriedJoint: $(300_000) },
        cutPerStep: $(100),
        joint: true,
        rule: "26 USC 225 (qualified overtime: the FLSA premium only)",
      },
      carLoanInterest: {
        max: { normal: $(10_000), marriedJoint: $(10_000) },
        phaseOutFrom: { normal: $(100_000), marriedJoint: $(200_000) },
        cutPerStep: $(200),
        joint: false,
        rule: "26 USC 163(h)(4) (new US-assembled car, loan after 2024, VIN on the return)",
      },
      step: $(1_000),
      senior: {
        perPerson: $(6_000),
        minAge: 65,
        phaseOutFrom: { normal: $(75_000), marriedJoint: $(150_000) },
        phaseOutRate: 0.06,
        rule: "26 USC 151(d)(5)(C) (age 65 or older: born before January 2, 1961 for 2025)",
      },
    },
    {
      source: S1A,
      alsoSources: [I1040, code("224"), code("225"), code("163"), code("151")],
      where:
        "2025 Schedule 1-A lines 7, 9, 15, 17, 24, 26, 28 to 29, 32 to 36 ($25,000 tips, $12,500 / $25,000 overtime, $10,000 car loan interest, $6,000 senior; phase-outs $100 per $1,000 above $150,000 / $300,000 for tips and overtime, $200 per $1,000 above $100,000 / $200,000 rounded up for car loan interest, 6 percent above $75,000 / $150,000 for seniors); the 2025 Form 1040 instructions, Schedule 1-A Part IV ($10,000; $200,000 joint and $100,000 all other filing statuses, no joint-return requirement stated for car loan interest, unlike Parts II, III and V)",
    },
  ),
  savers: cited(
    {
      taxYear: 2025,
      agiLimit: {
        single: $(39_500),
        married_separate: $(39_500),
        head_of_household: $(59_250),
        married_joint: $(79_000),
      },
      maxContribution: $(2_000),
      lowestRate: 0.1,
      iraDeadline: "2026-04-15",
      rule: "26 USC 25B; IRS Form 8880",
    },
    {
      source: F8880,
      alsoSources: [N2480],
      where:
        "2025 Form 8880 caution box and line 9 table (no credit over $39,500; $59,250 head of household; $79,000 joint; 50 / 20 / 10 percent tiers at $23,750 / $25,500 and the like) and line 6 ($2,000 a person); Notice 2024-80, 25B(b)(1)(C) and (D) limits",
      verify:
        "Only the 10% tier and the top limit are held (the same shape as 2026); the full tier table is a later step. The 2025 table was read in full: 50% up to $23,750 single ($47,500 joint, $35,625 head of household), 20% to $25,500 ($51,000, $38,250), 10% to $39,500 ($79,000, $59,250).",
    },
  ),
  saversMatch: cited(
    {
      firstYear: 2027,
      shownFrom: "2026-08-07",
      shownUntil: "2027-12-31",
      rate: 0.5,
      maxContribution: $(2_000),
      phaseOut: {
        single: [$(20_500), $(35_500)],
        married_separate: [$(20_500), $(35_500)],
        head_of_household: [$(30_750), $(53_250)],
        married_joint: [$(41_000), $(71_000)],
      },
      rule: "IRS Notice 2026-48 (proposed)",
    },
    {
      source: N2648,
      alsoSources: [F8880],
      where:
        "Notice 2026-48, section III: phase-out ranges $41,000 to $71,000 joint, $30,750 to $53,250 head of household, $20,500 to $35,500 others; the 2025 Form 8880 'What's New' says the saver's match replaces the credit from 2027 tax returns. Not a 2025 rule: carried so the shape matches the 2026 file.",
      verify:
        "The notice announces regulations the IRS intends to propose; the rules are not final, so the figures stay labelled 'proposed' wherever they show. It starts with 2027 returns, so it is not part of tax year 2025's law.",
    },
  ),
  rothCatchUp: cited(
    {
      priorYearFicaWagesOver: $(145_000),
      requiredFrom: 2027,
      rule: "26 USC 414(v)(7); T.D. 10033",
      // The wage threshold by the year the catch-up is made (the wages are those of the year before).
      overByCatchUpYear: { 2025: $(145_000), 2026: $(150_000), 2027: $(155_000) },
    },
    {
      source: N2480,
      alsoSources: [N2567, N2666],
      where:
        "Notice 2024-80: $145,000 on 2024 wages (2025 catch-ups); Notice 2025-67: $150,000 on 2025 wages (2026 catch-ups); Notice 2026-66: $155,000 on 2026 wages (2027 catch-ups)",
      verify:
        "The thresholds were read in the three notices. requiredFrom (2027) is the final regulations' applicability date (T.D. 10033), the same meaning as in the 2026 file, not necessarily the first year the statute applies (2026, with a good-faith reading allowed); it was not re-read in T3, and nothing in the app reads this yet.",
    },
  ),
  studentLoanInterest: cited(
    {
      max: $(2_500),
      phaseOut: {
        single: [$(85_000), $(100_000)],
        married_joint: [$(170_000), $(200_000)],
        married_separate: null,
        head_of_household: [$(85_000), $(100_000)],
      },
    },
    {
      source: RP2440,
      where:
        "Rev. Proc. 2024-40 section 2.30: phase-out starts at $85,000 ($170,000 joint), ends at $100,000 ($200,000 joint); $2,500 maximum (26 USC 221(b)(1)); not allowed for married filing separately (221(e)(2))",
    },
  ),
  salt: cited(
    {
      cap: { normal: $(40_000), marriedSeparate: $(20_000) },
      phaseDownFrom: { normal: $(500_000), marriedSeparate: $(250_000) },
      phaseDownRate: 0.3,
      floor: { normal: $(10_000), marriedSeparate: $(5_000) },
    },
    {
      source: code("164"),
      alsoSources: [I1040],
      where:
        "26 USC 164(b)(7)(A)(i): $40,000 for 2025; (b)(7)(B): 30 percent over $500,000 for 2025 (half for separate), never below $10,000; (b)(6) halves the limit for separate returns; the 2025 Form 1040 instructions ($40,000, $20,000 if married filing separately; phase-down over $500,000, $250,000)",
    },
  ),
  // Not in the 2025 law: the 0.5 percent floor and the non-itemizer deduction both start with tax
  // years beginning after 2025, so for 2025 the floor is zero and the non-itemizer amount is zero.
  charity: cited(
    { floorShare: 0, nonItemizer: { normal: 0, marriedJoint: 0 } },
    {
      source: code("170"),
      where:
        "26 USC 170(b)(1)(I) (0.5 percent floor) and 170(p) (non-itemizer deduction $1,000 / $2,000) were added by Pub. L. 119-21 sections 70424 to 70429 for taxable years beginning after December 31, 2025 (the Effective Date of 2025 Amendment note); so 2025 has no floor and no non-itemizer deduction (2026 has both: 0.005 and $1,000 / $2,000)",
    },
  ),
  medical: cited(
    { floorShare: 0.075 },
    { source: code("213"), where: "26 USC 213(a): 7.5 percent of adjusted gross income" },
  ),
  contributionLimits: cited(
    {
      workplace: $(23_500),
      workplaceCatchUp50: $(7_500),
      workplaceCatchUp60to63: $(11_250),
      ira: $(7_000),
      iraCatchUp50: $(1_000),
      hsaSelf: $(4_300),
      hsaFamily: $(8_550),
      hsaCatchUp55: $(1_000),
      healthFsa: $(3_300),
      dependentCareFsa: $(5_000),
      dependentCareFsaMarriedSeparate: $(2_500),
    },
    {
      source: N2480,
      alsoSources: [RP2425, RP2440, I2441, code("223")],
      where:
        "Notice 2024-80 (401(k) $23,500, catch-up $7,500 and $11,250 at ages 60 to 63, IRA $7,000 and $1,000 catch-up); Rev. Proc. 2024-25 section 2.01 (HSA $4,300 / $8,550); Rev. Proc. 2024-40 section 2.16 (health FSA $3,300); the 2025 Form 2441 instructions (dependent care exclusion $5,000, $2,500 if married filing separately; $7,500 / $3,750 starts in 2026); 26 USC 223(b)(3) (HSA catch-up $1,000 from 2009)",
    },
  ),
  // The child and dependent care credit under the law before 2026: 35 percent, less 1 point for each
  // $2,000 or fraction over $15,000, down to 20 percent (reached over $43,000), the same for every
  // filing status. There is no second ladder, so the bottom share equals the middle one and the
  // second step never lowers the share; its start is set at the end of the first ladder.
  dependentCare: cited(
    {
      costLimit: [$(3_000), $(6_000)],
      topShare: 0.35,
      middleShare: 0.2,
      bottomShare: 0.2,
      firstStepFrom: $(15_000),
      secondStepFrom: { normal: $(43_000), marriedJoint: $(43_000) },
      stepSize: { normal: $(2_000), marriedJoint: $(2_000) },
    },
    {
      source: F2441,
      alsoSources: [I2441, code("21")],
      where:
        "2025 Form 2441 line 8 table (.35 up to $15,000, then .34 down to .21 in $2,000 bands, .20 over $43,000) and line 3 ($3,000 one person, $6,000 two or more); 26 USC 21(a)(2) and (c) as in force for tax years before 2026 (35 percent reduced one point per $2,000 over $15,000, not below 20 percent)",
    },
  ),
  education: cited(
    {
      aotcMax: $(2_500),
      llcRate: 0.2,
      llcCostLimit: $(10_000),
      phaseOut: {
        single: [$(80_000), $(90_000)],
        married_joint: [$(160_000), $(180_000)],
      },
    },
    {
      source: I8863,
      alsoSources: [code("25A")],
      where:
        "2025 Form 8863 instructions: American opportunity credit up to $2,500 (MAGI $80,000 to $90,000, $160,000 to $180,000 joint), lifetime learning credit 20 percent of up to $10,000 (same ranges); 26 USC 25A(b), (c), (d)",
    },
  ),
  energy: cited(
    {
      rate: 0.3,
      improvementCap: $(1_200),
      heatPumpCap: $(2_000),
      homeEnds: "2025-12-31",
      vehicleEnds: "2025-09-30",
    },
    {
      source: ENFAQ,
      alsoSources: [code("25C")],
      where:
        "26 USC 25C(a) 30 percent, (b)(1) $1,200 a year, (b)(2) $2,000 for heat pumps and biomass stoves, (i) no property placed in service after 2025-12-31; the IRS FAQ on the 2025 law: 25D ends for expenditures after 2025-12-31, 25E and 30D for vehicles acquired after 2025-09-30",
    },
  ),
  amt: cited(
    {
      exemption: {
        single: $(88_100),
        married_joint: $(137_000),
        married_separate: $(68_500),
        head_of_household: $(88_100),
      },
      phaseOutStart: {
        single: $(626_350),
        married_joint: $(1_252_700),
        married_separate: $(626_350),
        head_of_household: $(626_350),
      },
      phaseOutRate: 0.25,
      lowRate: 0.26,
      highRate: 0.28,
      highRateFrom: {
        single: $(239_100),
        married_joint: $(239_100),
        married_separate: $(119_550),
        head_of_household: $(239_100),
      },
    },
    {
      source: RP2440,
      alsoSources: [code("55")],
      where:
        "Rev. Proc. 2024-40 section 2.11: exemption $137,000 joint, $88,100 unmarried (head of household included), $68,500 separate; 28 percent over $239,100 ($119,550 separate); phase-out starts $1,252,700 joint, $626,350 unmarried and separate. 26 USC 55(b)(1) 26 / 28 percent and 55(d)(2) 25 percent phase-out (the 50 percent rate is for tax years after 2025)",
    },
  ),
  mileage: cited(
    {
      businessCentsPerMile: 70,
      businessByPeriod: [{ from: "2025-01-01", to: "2025-12-31", centsPerMile: 70 }],
    },
    {
      source: N2505,
      where: "Notice 2025-5, section 3: 70 cents per mile for all miles of business use in 2025",
    },
  ),
  homeOffice: cited(
    { perSquareFoot: $(5), maxSquareFeet: 300 },
    {
      source: RP1313,
      where:
        "Rev. Proc. 2013-13, the safe harbor method: $5.00 a square foot, up to 300 square feet",
    },
  ),
};
