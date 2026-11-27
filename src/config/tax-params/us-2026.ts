import type { Bracket, Cited, FederalParams, ParamStatus } from "./types";

// United States federal figures for tax year 2026 (Tax T1). Every figure that used to sit in
// src/config/tax-rates.ts and the AMT table in src/config/equity-tax.ts is here, with the address
// of the page it was read at. The values are copied, not changed; the proof that none moved (golden
// files written from origin/main, compared in part 2 of Tax T1) is in the second pull request.
//
// All money is in cents; rates are fractions. FOR REVIEW by someone qualified before it is relied
// on, and again each year.

const $ = (dollars: number) => Math.round(dollars * 100);

// The day the sources below were read for this file.
const READ = "2026-11-27";

const RP2532 = "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf";
const N2567 = "https://www.irs.gov/pub/irs-drop/n-25-67.pdf";
const RP2519 = "https://www.irs.gov/pub/irs-drop/rp-25-19.pdf";
const N2610 = "https://www.irs.gov/pub/irs-drop/n-26-10.pdf";
const N2648 = "https://www.irs.gov/pub/irs-drop/n-26-48.pdf";
const RP1313 = "https://www.irs.gov/pub/irs-drop/rp-13-13.pdf";
const F8880 = "https://www.irs.gov/pub/irs-pdf/f8880.pdf";
const P505 = "https://www.irs.gov/pub/irs-pdf/p505.pdf";
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
  } satisfies Record<string, readonly Bracket[]>,
  {
    source: RP2532,
    where:
      "section 4.01, Tables 1 to 4 (married joint, head of household, single, married separate). Head of household 24%/32%/35% edges read as $201,750 and $256,200 (Table 2); single and married separate are $201,775 and $256,225 (Tables 3 and 4). The code's old comment that sources disagree is settled.",
  },
);

const capitalGains = cited(
  {
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
  } satisfies Record<string, readonly Bracket[]>,
  { source: RP2532, where: "section 4.03, maximum zero rate and 15 percent rate amounts" },
);

export const US_2026: FederalParams = {
  year: 2026,
  brackets,
  capitalGains,
  standardDeduction: cited(
    {
      single: $(16_100),
      married_joint: $(32_200),
      married_separate: $(16_100),
      head_of_household: $(24_150),
    },
    { source: RP2532, where: "section 4.14(1), standard deduction table" },
  ),
  additionalStandard: cited(
    { unmarried: $(2_050), married: $(1_650) },
    { source: RP2532, where: "section 4.14(3), aged or blind" },
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
      alsoSources: [code("24")],
      where:
        "RP 2025-32 section 4.05 ($2,200 credit, $1,700 refundable part); 26 USC 24(b)(1) ($50 for each $1,000 or fraction), 24(h)(3) ($200,000 / $400,000); re-read 2026-11-27 at law.cornell.edu: 24(d)(1)(B)(i) with 24(h)(6) (15 percent of earned income over $2,500), 24(h)(4) ($500 for each other dependent), 24(h)(5) ($1,400 refundable cap, indexed after 2024, which Rev. Proc. 2025-32 gives as $1,700)",
    },
  ),
  eitc: cited(
    {
      maxCredit: [$(664), $(4_427), $(7_316), $(8_231)],
      phaseInRate: [0.0765, 0.34, 0.4, 0.45],
      phaseOutRate: [0.0765, 0.1598, 0.2106, 0.2106],
      phaseOutFrom: {
        single: [$(10_860), $(23_890), $(23_890), $(23_890)],
        married_joint: [$(18_140), $(31_160), $(31_160), $(31_160)],
      },
      investmentIncomeLimit: $(12_200),
      childlessMinAge: 25,
      childlessMaxAge: 64,
    },
    {
      source: RP2532,
      alsoSources: [
        "https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit/who-qualifies-for-the-earned-income-tax-credit-eitc",
      ],
      where:
        "section 4.06(1) table (maximum credit, phase-out thresholds) and 4.06(2) (investment income over $12,200: confirmed, replaces the old ESTIMATE TO VERIFY)",
      verify:
        "The phase-in and phase-out rates (26 USC 32(b)) and the 25 to 64 age range for filers without children were not re-read in T1.",
    },
  ),
  selfEmployment: cited(
    {
      netEarningsShare: 0.9235,
      socialSecurityRate: 0.124,
      medicareRate: 0.029,
      wageBase: $(184_500),
      minimumNetEarnings: $(400),
    },
    {
      source: P505,
      alsoSources: ["https://www.irs.gov/pub/irs-pdf/i1040sse.pdf"],
      where:
        "Social Security wage base 2026 (Pub 505); Schedule SE instructions for the rates and the $400 floor",
      verify:
        "The $184,500 wage base was read only by the research catalogue (row SE-003); the SSA page refused this step. The rates and the $400 floor are statute (26 USC 1401, 1402) and were not re-read.",
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
        "26 USC 3101(b)(2): 0.9 percent over $250,000 joint, $125,000 separate, $200,000 other (not indexed)",
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
    { source: code("1411"), where: "26 USC 1411(a)(1) and (b) (not indexed)" },
  ),
  qbi: cited(
    {
      rate: 0.2,
      threshold: {
        single: $(201_750),
        married_joint: $(403_500),
        married_separate: $(201_775),
        head_of_household: $(201_750),
      },
    },
    {
      source: RP2532,
      where:
        "section 4.26 threshold amounts under 199A(e)(2): $403,500 joint, $201,775 separate, $201,750 all other",
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
        "224(b)(1), (b)(2)(A), (f); 225(b)(1), (b)(2)(A), (e); 163(h)(4)(C); 151(d)(5)(C)(i) to (v). All read.",
      verify:
        "Car loan interest for married filing separately is not read (roadmap 6.2 row 4, T19); the tipped-occupation and qualified-overtime definitions are T19's.",
    },
  ),
  savers: cited(
    {
      taxYear: 2026,
      agiLimit: {
        single: $(40_250),
        married_separate: $(40_250),
        head_of_household: $(60_375),
        married_joint: $(80_500),
      },
      maxContribution: $(2_000),
      lowestRate: 0.1,
      iraDeadline: "2027-04-15",
      rule: "26 USC 25B; IRS Form 8880",
    },
    {
      source: N2567,
      alsoSources: [F8880],
      where:
        "Notice 2025-67, the 25B(b)(1)(C)/(D) limit $40,250 (head of household 1.5 times, joint 2 times); the 50% and 20% tier lines ($24,250 / $26,250 single) are in the same notice",
      verify:
        "The $2,000 a person cap and the 10% lowest rate were not re-read (Form 8880 not opened in T1). Only the 10% tier is used today; the full tier table is a later step.",
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
        "Notice 2026-48, section III: phase-out ranges $41,000 to $71,000 joint, $30,750 to $53,250 head of household, $20,500 to $35,500 others",
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
      source: "https://www.irs.gov/pub/irs-drop/n-26-66.pdf",
      alsoSources: [N2567],
      where:
        "Notice 2026-66 (read 2026-11-27), the paragraph on section 414(v)(7)(A): the Roth catch-up wage threshold for 2026, used to decide whether catch-up contributions for 2027 must be Roth, rises from $150,000 to $155,000. Notice 2025-67: $150,000 for 2025 wages (2026 catch-ups).",
      verify:
        "Only 2026 and 2027 catch-up years are published. The threshold is indexed, so a later year's is higher than $155,000 and not yet known; a reader asked about a later year uses the 2027 figure and says so.",
    },
  ),
  studentLoanInterest: cited(
    {
      max: $(2_500),
      phaseOut: {
        single: [$(85_000), $(100_000)],
        married_joint: [$(175_000), $(205_000)],
        married_separate: null,
        head_of_household: [$(85_000), $(100_000)],
      },
    },
    {
      source: RP2532,
      where:
        "section 4.29: phase-out starts at $85,000 ($175,000 joint), ends at $100,000 ($205,000 joint)",
    },
  ),
  salt: cited(
    {
      cap: { normal: $(40_400), marriedSeparate: $(20_200) },
      phaseDownFrom: { normal: $(505_000), marriedSeparate: $(252_500) },
      phaseDownRate: 0.3,
      floor: { normal: $(10_000), marriedSeparate: $(5_000) },
    },
    {
      source: code("164"),
      where:
        "26 USC 164(b)(7)(A): $40,400 for 2026; (b)(7)(B): 30 percent over $505,000 (half for separate), never below $10,000; (b)(6)(B) halves for separate returns",
    },
  ),
  charity: cited(
    { floorShare: 0.005, nonItemizer: { normal: $(1_000), marriedJoint: $(2_000) } },
    {
      source: code("170"),
      alsoSources: [P505],
      where:
        "26 USC 170(b)(1)(I) 0.5 percent floor (read); 170(p) non-itemizer deduction $1,000 / $2,000 (Pub 505, research catalogue row OB-008)",
      verify:
        "The non-itemizer $1,000 / $2,000 (170(p)) was read only by the research catalogue; 170(p) was past the end of the page this step could read.",
    },
  ),
  medical: cited(
    { floorShare: 0.075 },
    {
      source: code("213"),
      where: "26 USC 213(a): 7.5 percent of adjusted gross income",
      status: "unconfirmed",
      verify: "Not read at the source in T1 (statute, long unchanged); kept as the code had it.",
    },
  ),
  contributionLimits: cited(
    {
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
    },
    {
      source: N2567,
      alsoSources: [RP2519, RP2532, code("129")],
      where:
        "Notice 2025-67 (401(k) $24,500, catch-up $8,000 and $11,250, IRA $7,500 and $1,100); Rev. Proc. 2025-19 section 2.01 (HSA $4,400 / $8,750); Rev. Proc. 2025-32 section 4.15 (health FSA $3,400); 26 USC 129(a)(2)(A) ($7,500, $3,750 separate); 26 USC 223(b)(3) (HSA catch-up at 55: $1,000 fixed, not indexed; re-read 2026-11-27)",
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
        "26 USC 21(a)(2) as amended for tax years beginning after 2025: 50 percent, less 1 point per $2,000 over $15,000 down to 35, then 1 point per $2,000 ($4,000 joint) over $75,000 ($150,000 joint) down to 20; 21(c) $3,000 / $6,000. The old ESTIMATE TO VERIFY is settled.",
      verify:
        "The final 2026 Form 2441 instructions are not out; the IRS draft (irs-dft/i2441--dft.pdf) could not be text-read in T1. T17 re-checks against the final.",
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
        "26 USC 25A(b) (100% of $2,000 and 25% of the next $2,000; 40% refundable), 25A(c) (20% of up to $10,000), 25A(d) ($80,000 / $160,000 start, $10,000 / $20,000 range)",
      verify:
        "Rev. Proc. 2025-32 lists no inflation change to these ranges for 2026; the Lifetime Learning range is not seen in it either, so it is taken as unchanged.",
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
      where:
        "The IRS FAQ on the OBBBA changes: 25C and 25D end for property placed in service after 2025-12-31; 30D and 25E end for vehicles acquired after 2025-09-30",
      verify:
        "These are tax year 2025 figures kept on the 2026 record until us-2025.ts exists (T3). The 30%, $1,200 and $2,000 amounts (26 USC 25C, 25D) were not re-read.",
    },
  ),
  amt: cited(
    {
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
      phaseOutRate: 0.5,
      lowRate: 0.26,
      highRate: 0.28,
      highRateFrom: {
        single: $(244_500),
        married_joint: $(244_500),
        married_separate: $(122_250),
        head_of_household: $(244_500),
      },
    },
    {
      source: RP2532,
      alsoSources: [code("55")],
      where:
        "section 4.10 (read 2026-11-27): exemption $140,200 joint, $90,100 unmarried, $70,100 separate; the 28 percent rate applies above $244,500 ($122,250 separate); phase-out starts at $1,000,000 joint, $500,000 otherwise and is complete at $1,280,400 joint, $680,200 unmarried, $640,200 separate (each is the exemption divided by 0.5 above the start). Rate: 26 USC 55(d)(4)(A)(ii)(IV), added by Pub. L. 119-21 section 70107(c) for taxable years beginning after 2025: \"by substituting '50 percent' for '25 percent'\" (law.cornell.edu, read 2026-11-27). The 26 and 28 percent rates are 26 USC 55(b)(1)(A).",
    },
  ),
  mileage: cited(
    {
      // Cents per mile for a mile with no date: the rate of the first period, so a year's total
      // is never overstated. Every reader with a trip's date uses businessByPeriod instead.
      businessCentsPerMile: 72.5,
      businessByPeriod: [
        { from: "2026-01-01", to: "2026-06-30", centsPerMile: 72.5 },
        { from: "2026-07-01", to: "2026-12-31", centsPerMile: 76 },
      ],
    },
    {
      source: N2610,
      alsoSources: ["https://www.irs.gov/tax-professionals/standard-mileage-rates"],
      where:
        "IRS standard mileage rates page (read 2026-11-27): business 72.5 cents for January 1 to June 30, 2026 (IR-2025-128, Notice 2026-10 section 3) and 76 cents for July 1 to December 31, 2026 (IR-2026-29).",
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
