import { awaited } from "./awaited";
import type { Bracket, Cited, FederalParams, ParamStatus } from "./types";

// United States federal figures for tax year 2027 (Tax T32), in the same shape as us-2026.ts.
// Every figure was transcribed from the primary source named beside it, read in full on the day
// below: Rev. Proc. 2026-35 (the inflation adjustments, announced 2026-11-05, IR-2026-133; read as
// the IRS advance copy and again in Internal Revenue Bulletin 2026-48), Notice 2026-66 (retirement
// limits, IR-2026-136), Rev. Proc. 2026-24 (Health Savings Accounts, IRB 2026-25), the Social
// Security Administration's Federal Register notice of the 2027 wage base, and the Code.
//
// THIS YEAR IS A DRAFT. One group is not published yet: the business standard mileage rate for 2027
// (the IRS usually announces it in December). It is marked "unconfirmed" with a zero value, not
// guessed and not copied from 2026. Until it is published and the file is complete, 2027 stays out
// of SUPPORTED_TAX_YEARS: `federalParams(2027)` refuses it, and the nightly check keeps warning
// (docs/tax/law-change.md). All money is in cents; rates are fractions.
//
// FOR REVIEW by someone qualified before it is relied on.

const $ = (dollars: number) => Math.round(dollars * 100);

// The day the sources below were read for this file.
const READ = "2026-11-27";

const RP2635 = "https://www.irs.gov/pub/irs-drop/rp-26-35.pdf";
const IRB48 = "https://www.irs.gov/irb/2026-48_irb";
const N2666 = "https://www.irs.gov/pub/irs-drop/n-26-66.pdf";
const N2648 = "https://www.irs.gov/pub/irs-drop/n-26-48.pdf";
const RP2624 = "https://www.irs.gov/pub/irs-drop/rp-26-24.pdf";
const RP1313 = "https://www.irs.gov/pub/irs-drop/rp-13-13.pdf";
const SSA_NOTICE = "https://www.federalregister.gov/d/2026-21796";
const SSA_NOTICE_PDF = "https://public-inspection.federalregister.gov/2026-21796.pdf";
const MILEAGE_PAGE = "https://www.irs.gov/tax-professionals/standard-mileage-rates";
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
      { over: $(12_800), rate: 0.12 },
      { over: $(52_025), rate: 0.22 },
      { over: $(109_125), rate: 0.24 },
      { over: $(208_325), rate: 0.32 },
      { over: $(264_550), rate: 0.35 },
      { over: $(661_375), rate: 0.37 },
    ],
    married_joint: [
      { over: 0, rate: 0.1 },
      { over: $(25_600), rate: 0.12 },
      { over: $(104_050), rate: 0.22 },
      { over: $(218_250), rate: 0.24 },
      { over: $(416_650), rate: 0.32 },
      { over: $(529_100), rate: 0.35 },
      { over: $(793_650), rate: 0.37 },
    ],
    married_separate: [
      { over: 0, rate: 0.1 },
      { over: $(12_800), rate: 0.12 },
      { over: $(52_025), rate: 0.22 },
      { over: $(109_125), rate: 0.24 },
      { over: $(208_325), rate: 0.32 },
      { over: $(264_550), rate: 0.35 },
      { over: $(396_825), rate: 0.37 },
    ],
    head_of_household: [
      { over: 0, rate: 0.1 },
      { over: $(18_250), rate: 0.12 },
      { over: $(69_650), rate: 0.22 },
      { over: $(109_100), rate: 0.24 },
      { over: $(208_300), rate: 0.32 },
      { over: $(264_550), rate: 0.35 },
      { over: $(661_350), rate: 0.37 },
    ],
  } satisfies Record<string, readonly Bracket[]>,
  {
    source: RP2635,
    alsoSources: [IRB48],
    where:
      "section 3.01, Tables 1 to 4 (married joint, head of household, single, married separate), read in the advance copy and in IRB 2026-48. Head of household 24% edge $109,100 and 32% edge $208,300 (Table 2) differ from single's $109,125 and $208,325 (Table 3).",
  },
);

const capitalGains = cited(
  {
    single: [
      { over: 0, rate: 0 },
      { over: $(51_050), rate: 0.15 },
      { over: $(563_200), rate: 0.2 },
    ],
    married_joint: [
      { over: 0, rate: 0 },
      { over: $(102_100), rate: 0.15 },
      { over: $(633_600), rate: 0.2 },
    ],
    married_separate: [
      { over: 0, rate: 0 },
      { over: $(51_050), rate: 0.15 },
      { over: $(316_800), rate: 0.2 },
    ],
    head_of_household: [
      { over: 0, rate: 0 },
      { over: $(68_350), rate: 0.15 },
      { over: $(598_400), rate: 0.2 },
    ],
  } satisfies Record<string, readonly Bracket[]>,
  {
    source: RP2635,
    alsoSources: [IRB48],
    where: "section 3.03, maximum zero rate and 15 percent rate amounts",
  },
);

export const US_2027: FederalParams = {
  year: 2027,
  brackets,
  capitalGains,
  standardDeduction: cited(
    {
      single: $(16_600),
      married_joint: $(33_200),
      married_separate: $(16_600),
      head_of_household: $(24_925),
    },
    {
      source: RP2635,
      alsoSources: [IRB48],
      where: "section 3.15(1), standard deduction table",
    },
  ),
  additionalStandard: cited(
    { unmarried: $(2_100), married: $(1_700) },
    {
      source: RP2635,
      alsoSources: [IRB48],
      where:
        "section 3.15(3), aged or blind ($1,700, $2,100 if unmarried and not a surviving spouse)",
    },
  ),
  dependentStandard: cited(
    { floor: $(1_400), plusEarned: $(500) },
    {
      source: RP2635,
      alsoSources: [IRB48],
      where:
        "section 3.15(2), dependent: the greater of $1,400 or earned income plus $500 (read 2026-11-27)",
    },
  ),
  capitalLoss: cited(
    { normal: $(3_000), marriedSeparate: $(1_500) },
    {
      source: code("1211"),
      where: "26 USC 1211(b)(1) (statute, not indexed)",
    },
  ),
  ctc: cited(
    {
      perChild: $(2_300),
      refundablePerChild: $(1_800),
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
      source: RP2635,
      alsoSources: [IRB48, code("24")],
      where:
        "RP 2026-35 section 3.05 ($2,300 credit, $1,800 refundable part); 26 USC 24(b)(1) ($50 for each $1,000 or fraction), 24(h)(3) ($200,000 / $400,000), 24(h)(4) ($500 for each other dependent), 24(h)(6) ($2,500 earned income threshold; 15 percent in 24(d)(1)(B)(i)); 24(i)(1) and (2) index only the $1,400 refundable cap and the $2,200 credit amount (rounded down to $100), which section 3.05 gives as $1,800 and $2,300. Read 2026-11-27.",
    },
  ),
  eitc: cited(
    {
      maxCredit: [$(685), $(4_573), $(7_552), $(8_496)],
      phaseInRate: [0.0765, 0.34, 0.4, 0.45],
      phaseOutRate: [0.0765, 0.1598, 0.2106, 0.2106],
      phaseOutFrom: {
        single: [$(11_210), $(24_660), $(24_660), $(24_660)],
        married_joint: [$(18_730), $(32_170), $(32_170), $(32_170)],
      },
      investmentIncomeLimit: $(12_600),
      childlessMinAge: 25,
      childlessMaxAge: 64,
    },
    {
      source: RP2635,
      alsoSources: [IRB48, code("32")],
      where:
        "section 3.06(1) table (earned income amount, maximum credit, threshold and completed phaseout amounts, no children / 1 / 2 / 3 or more) and 3.06(2) (investment income over $12,600). 26 USC 32(b)(1) credit and phaseout percentages (7.65 / 34 / 40 / 45 and 7.65 / 15.98 / 21.06 / 21.06) and 32(c)(1)(A)(ii)(II) (age 25 but not 65, so 25 to 64) re-read 2026-11-27. The maximum credit is the rate times the earned income amount, and the completed phaseout amount is the threshold plus the maximum credit over the phaseout rate: both checked in us-2027.test.ts.",
    },
  ),
  selfEmployment: cited(
    {
      netEarningsShare: 0.9235,
      socialSecurityRate: 0.124,
      medicareRate: 0.029,
      wageBase: $(192_300),
      minimumNetEarnings: $(400),
    },
    {
      source: SSA_NOTICE,
      alsoSources: [SSA_NOTICE_PDF, code("1401"), code("1402")],
      where:
        "The Social Security Administration's notice 'Cost-of-Living Increase and Other Determinations for 2027' (Federal Register document 2026-21796, public inspection copy read 2026-11-27; scheduled for publication 2026-10-26): the OASDI contribution and benefit base is $192,300 for self-employment income earned in tax years beginning in 2027 (1994 base $60,600 times the 2025 wage index $72,800.33 over $22,935.42 is $192,353.14, rounded to a multiple of $300). 26 USC 1401(a) 12.4 percent and (b)(1) 2.9 percent; 1402(a)(12) (one half of the sum of the rates, so 92.35 percent); 1402(b)(2) ($400) re-read 2026-11-27.",
      verify:
        "The SSA's own pages (ssa.gov) refused automated reading (HTTP 403) on 2026-11-27, so the wage base was read in its Federal Register notice. The 2027 Schedule SE instructions are not out.",
    },
  ),
  payroll: cited(
    { socialSecurityRate: 0.062, medicareRate: 0.0145 },
    {
      source: code("3101"),
      where: "26 USC 3101(a) 6.2 percent and (b)(1) 1.45 percent, re-read 2026-11-27",
    },
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
        "26 USC 3101(b)(2): 0.9 percent over $250,000 joint, $125,000 separate, $200,000 other (not indexed), re-read 2026-11-27",
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
        "26 USC 1411(a)(1) 3.8 percent and (b) $250,000 / $125,000 / $200,000 (not indexed), re-read 2026-11-27",
    },
  ),
  qbi: cited(
    {
      rate: 0.2,
      threshold: {
        single: $(208_300),
        married_joint: $(416_600),
        married_separate: $(208_325),
        head_of_household: $(208_300),
      },
    },
    {
      source: RP2635,
      alsoSources: [IRB48],
      where:
        "section 3.28(1) threshold amounts under 199A(e)(2): $416,600 joint, $208,325 separate, $208,300 all other",
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
        rule: "26 USC 151(d)(5)(C) (age 65 or older)",
      },
    },
    {
      source: code("224"),
      alsoSources: [code("225"), code("163"), code("151")],
      where:
        "224(b)(1) $25,000 and (b)(2)(A) $100 per $1,000 over $150,000 ($300,000 joint); 225(b)(1) $12,500 ($25,000 joint) and (b)(2)(A); 163(h)(4)(C)(i) $10,000 and (ii) $200 per $1,000 over $100,000 ($200,000 joint); 151(d)(5)(C)(i) to (iii) $6,000 per person 65 or older, reduced by 6 percent over $75,000 ($150,000 joint), for taxable years before 2029. None of these sections has an inflation adjustment, so they are the same as 2026. Read 2026-11-27.",
      verify:
        "Car loan interest for married filing separately is not read (roadmap 6.2 row 4, T19); the tipped-occupation and qualified-overtime definitions are T19's.",
    },
  ),
  savers: cited(
    {
      taxYear: 2027,
      agiLimit: {
        single: $(41_500),
        married_separate: $(41_500),
        head_of_household: $(62_250),
        married_joint: $(83_000),
      },
      maxContribution: $(2_000),
      lowestRate: 0.1,
      // April 15, 2028 is a Saturday and April 17 is the observed Emancipation Day holiday.
      iraDeadline: "2028-04-18",
      rule: "26 USC 25B; IRS Form 8880",
    },
    {
      source: N2666,
      alsoSources: [N2648],
      where:
        "Notice 2026-66, the section 25B(b)(1)(C) and (D) limit (the 10 percent tier): $83,000 joint, $62,250 head of household, $41,500 all other; the 50 and 20 percent tier limits are $50,000 / $54,000 joint, $37,500 / $40,500 head of household, $25,000 / $27,000 other, in the same notice.",
      verify:
        "For taxable years beginning after 2026 the Saver's Match replaces the Saver's Credit for plan and IRA contributions; the credit continues only for ABLE account contributions (Notice 2026-48, Q&A A-1). Nothing here says how a 2027 return claims it, so a reader must not show these limits for an IRA or plan contribution: use saversMatch. The $2,000 a person cap and the 10 percent lowest rate were not re-read.",
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
      where:
        "Notice 2026-48, section III: phase-out ranges $41,000 to $71,000 joint, $30,750 to $53,250 head of household, $20,500 to $35,500 others; the amounts are statutory for 2027 and inflation-adjusted only for taxable years after 2027 (26 USC 6433(h)(1), quoted in the notice)",
      verify:
        "The notice announces regulations the IRS intends to propose; the rules are not final, so the figures stay labelled 'proposed' wherever they show.",
    },
  ),
  rothCatchUp: cited(
    {
      // The threshold of the first year the rule is required (2027 catch-ups, set by 2026 wages).
      priorYearFicaWagesOver: $(155_000),
      requiredFrom: 2027,
      rule: "26 USC 414(v)(7); T.D. 10033",
      // The wage threshold by the year the catch-up is made (the wages are those of the year before).
      overByCatchUpYear: { 2026: $(150_000), 2027: $(155_000) },
    },
    {
      source: N2666,
      where:
        "Notice 2026-66 (read 2026-11-27), the paragraph on section 414(v)(7)(A): the Roth catch-up wage threshold for 2026 wages, which decides whether catch-up contributions for 2027 must be Roth, rises from $150,000 to $155,000.",
      verify:
        "The threshold for 2027 wages (which governs 2028 catch-ups) is published with the 2028 notice, around November 2027. Only the 2026 and 2027 catch-up years are known; a reader asked about a later year uses the 2027 figure and says so. requiredFrom (2027) is the final regulations' applicability date (T.D. 10033), not re-read here.",
    },
  ),
  studentLoanInterest: cited(
    {
      max: $(2_500),
      phaseOut: {
        single: [$(90_000), $(105_000)],
        married_joint: [$(180_000), $(210_000)],
        married_separate: null,
        head_of_household: [$(90_000), $(105_000)],
      },
    },
    {
      source: RP2635,
      alsoSources: [IRB48],
      where:
        "section 3.31: phase-out starts at $90,000 ($180,000 joint), ends at $105,000 ($210,000 joint)",
    },
  ),
  salt: cited(
    {
      cap: { normal: $(40_804), marriedSeparate: $(20_402) },
      phaseDownFrom: { normal: $(510_050), marriedSeparate: $(255_025) },
      phaseDownRate: 0.3,
      floor: { normal: $(10_000), marriedSeparate: $(5_000) },
    },
    {
      source: code("164"),
      where:
        "26 USC 164(b)(7)(A)(iii): for taxable years after 2026 and before 2030, 101 percent of the preceding year's amount, so $40,400 x 1.01 = $40,804; (b)(7)(B)(ii)(III): the threshold is 101 percent of the preceding year's, $505,000 x 1.01 = $510,050; 30 percent phase-down, never below $10,000, half of each amount for a separate return ((b)(6)(B), (b)(7)(B)(i)). Computed by the builder from the statute; Rev. Proc. 2026-35 does not list it. Read 2026-11-27.",
    },
  ),
  charity: cited(
    { floorShare: 0.005, nonItemizer: { normal: $(1_000), marriedJoint: $(2_000) } },
    {
      source: code("170"),
      where:
        "26 USC 170(b)(1)(I) 0.5 percent floor and 170(p) non-itemizer deduction of $1,000 ($2,000 joint), neither indexed; 170(p) read in full 2026-11-27",
    },
  ),
  medical: cited(
    { floorShare: 0.075 },
    {
      source: code("213"),
      where: "26 USC 213(a): 7.5 percent of adjusted gross income (statute, read 2026-11-27)",
    },
  ),
  contributionLimits: cited(
    {
      workplace: $(25_500),
      workplaceCatchUp50: $(8_500),
      workplaceCatchUp60to63: $(11_750),
      ira: $(7_500),
      iraCatchUp50: $(1_100),
      hsaSelf: $(4_500),
      hsaFamily: $(9_000),
      hsaCatchUp55: $(1_000),
      healthFsa: $(3_500),
      dependentCareFsa: $(7_500),
      dependentCareFsaMarriedSeparate: $(3_750),
    },
    {
      source: N2666,
      alsoSources: [RP2624, RP2635, IRB48, code("129"), code("223")],
      where:
        "Notice 2026-66 (401(k) $25,500, catch-up $8,500 and $11,750, IRA $7,500 and $1,100); Rev. Proc. 2026-24 section 3.01(1) (HSA $4,500 / $9,000); Rev. Proc. 2026-35 section 3.16 (health FSA $3,500); 26 USC 129(a)(2)(A) ($7,500, $3,750 separate; not indexed); 26 USC 223(b)(3) (HSA catch-up at 55: $1,000, not indexed). Read 2026-11-27.",
    },
  ),
  dependentCare: cited(
    {
      costLimit: [$(3_000), $(6_000)],
      topShare: 0.5,
      middleShare: 0.35,
      bottomShare: 0.2,
      firstStepFrom: $(15_000),
      secondStepFrom: { normal: $(75_000), marriedJoint: $(150_000) },
      stepSize: { normal: $(2_000), marriedJoint: $(4_000) },
    },
    {
      source: code("21"),
      where:
        "26 USC 21(a)(2): 50 percent, less 1 point per $2,000 over $15,000 down to 35, then 1 point per $2,000 ($4,000 joint) over $75,000 ($150,000 joint) down to 20; 21(c) $3,000 / $6,000. Section 21 has no inflation adjustment. Read 2026-11-27.",
      verify:
        "The 2027 Form 2441 and its instructions are not out; T17 checks the figures against them when they are.",
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
      source: code("25A"),
      where:
        "26 USC 25A(b) (100% of $2,000 and 25% of the next $2,000; 40% refundable), 25A(c) (20% of up to $10,000), 25A(d)(2) ($80,000 / $160,000 start, $10,000 / $20,000 range). Subsection (h), which indexed the Lifetime Learning Credit range, was repealed by Pub. L. 116-260, so the range is fixed; Rev. Proc. 2026-35 lists no 25A item. Read 2026-11-27.",
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
      source:
        "https://www.irs.gov/newsroom/faqs-for-modification-of-sections-25c-25d-25e-30c-30d-45l-45w-and-179d-under-public-law-119-21-139-stat-72-july-4-2025-commonly-known-as-the-one-big-beautiful-bill-obbb",
      alsoSources: [code("25C")],
      where:
        "These credits have ended: 25C and 25D for property placed in service after 2025-12-31, 25E and 30D for vehicles acquired after 2025-09-30, so there is no 2027 credit. The figures are the last ones (26 USC 25C(a) 30 percent, (b)(1) $1,200, (b)(2) $2,000), kept so the shape is the same as the other years; nothing may price them for 2027.",
    },
  ),
  amt: cited(
    {
      exemption: {
        single: $(93_000),
        married_joint: $(144_700),
        married_separate: $(72_350),
        head_of_household: $(93_000),
      },
      phaseOutStart: {
        single: $(515_950),
        married_joint: $(1_031_900),
        married_separate: $(515_950),
        head_of_household: $(515_950),
      },
      phaseOutRate: 0.5,
      lowRate: 0.26,
      highRate: 0.28,
      highRateFrom: {
        single: $(252_500),
        married_joint: $(252_500),
        married_separate: $(126_250),
        head_of_household: $(252_500),
      },
    },
    {
      source: RP2635,
      alsoSources: [IRB48, code("55")],
      where:
        "section 3.11 (read 2026-11-27): exemption $144,700 joint, $93,000 unmarried, $72,350 separate; the 28 percent rate applies above $252,500 ($126,250 separate); phase-out starts at $1,031,900 joint, $515,950 unmarried and separate and is complete at $1,321,300 joint, $701,950 unmarried, $660,650 separate. Rate 50 percent: 26 USC 55(d)(4)(A)(ii)(IV) for taxable years after 2025. The 26 and 28 percent rates are 26 USC 55(b)(1)(A).",
    },
  ),
  // AWAITED, not published. The 2027 business rate is announced by the IRS in a notice, usually in
  // December. The standard mileage rates page showed 72.5 and 76 cents for 2026 and nothing for 2027
  // on 2026-11-27. The group holds no value: reading it throws NoTaxParamsError(2027, "mileage")
  // (awaited.ts), so nothing can use 2026's rate, a zero or a guess for a 2027 mile.
  mileage: awaited<FederalParams["mileage"]["value"]>(2027, "mileage", {
    source: MILEAGE_PAGE,
    where:
      "IRS standard mileage rates page, read 2026-11-27: the newest rate is 76 cents for July 1 to December 31, 2026; no 2027 rate is published",
    checkedOn: READ,
    verify:
      "AWAITED: the IRS notice with the 2027 standard mileage rates (usually December 2026). Do not copy 2026's 72.5 and 76 cents. When it is out, fill the rate (by period if it changes mid-year) with cited(...) and status verified, and delete this note.",
  }),
  homeOffice: cited(
    { perSquareFoot: $(5), maxSquareFeet: 300 },
    {
      source: RP1313,
      where:
        "Rev. Proc. 2013-13, the safe harbor method: $5.00 a square foot, up to 300 square feet (re-read 2026-11-27; not indexed)",
    },
  ),
};
