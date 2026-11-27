import type { FilingStatus } from "@/config/tax";

// Tax parameters by tax year (Tax T1, docs: reports/Tax engine roadmap.md part 1.2). Every figure of
// a year's law lives in one file per year and jurisdiction, wrapped in `Cited`: the value, the
// web address of the primary source it was read at, where in that source, the day it was read, and
// how far it can be trusted. Money is in integer cents; rates are fractions.

// verified: read at the primary source (the IRS Revenue Procedure, a form's instructions, the Code).
// draft: read in an IRS draft document; shown with "(IRS draft instructions)".
// unconfirmed: not read at a primary source; a rule that needs it can't state an amount.
export type ParamStatus = "verified" | "draft" | "unconfirmed";

export type Cited<T> = Readonly<{
  value: T;
  // An https address on an allow-listed host (see ALLOWED_SOURCE_HOSTS).
  source: string;
  // More primary sources for the same figure group, when one document isn't enough.
  alsoSources?: readonly string[];
  // Where in the source: a section, table, line or page.
  where: string;
  // The day (ISO) the figure was read at the source.
  checkedOn: string;
  status: ParamStatus;
  // Set when something in this group is not confirmed at its source, or the source and the value
  // disagree. The completeness test lists every note, so none can be forgotten.
  verify?: string;
}>;

export const ALLOWED_SOURCE_HOSTS = [
  "irs.gov",
  "ftb.ca.gov",
  "law.cornell.edu",
  "congress.gov",
] as const;

// A bracket: the rate applies to income over `over` (cents), up to the next bracket.
export type Bracket = { over: number; rate: number };

type ByStatus<T> = Readonly<Record<FilingStatus, T>>;
type Four<T> = readonly [T, T, T, T];
type NormalJoint = { normal: number; marriedJoint: number };

export type FederalParams = Readonly<{
  year: number;
  // Rev. Proc. tables 1 to 4: ordinary income.
  brackets: Cited<ByStatus<readonly Bracket[]>>;
  // Long-term gains and qualified dividends: 0% / 15% / 20%.
  capitalGains: Cited<ByStatus<readonly Bracket[]>>;
  standardDeduction: Cited<ByStatus<number>>;
  // Per person 65 or older (or blind).
  additionalStandard: Cited<{ unmarried: number; married: number }>;
  // A net capital loss comes off other income up to this much a year.
  capitalLoss: Cited<{ normal: number; marriedSeparate: number }>;
  ctc: Cited<{
    perChild: number;
    refundablePerChild: number;
    earnedIncomeFloor: number;
    refundableRate: number;
    otherDependant: number;
    phaseOutStep: number;
    phaseOutPerStep: number;
    phaseOutFrom: ByStatus<number>;
  }>;
  eitc: Cited<{
    // By qualifying children: 0, 1, 2, 3 or more.
    maxCredit: Four<number>;
    phaseInRate: Four<number>;
    phaseOutRate: Four<number>;
    phaseOutFrom: { single: Four<number>; married_joint: Four<number> };
    investmentIncomeLimit: number;
    childlessMinAge: number;
    childlessMaxAge: number;
  }>;
  selfEmployment: Cited<{
    netEarningsShare: number;
    socialSecurityRate: number;
    medicareRate: number;
    wageBase: number;
    minimumNetEarnings: number;
  }>;
  payroll: Cited<{ socialSecurityRate: number; medicareRate: number }>;
  additionalMedicare: Cited<{ rate: number; threshold: ByStatus<number> }>;
  netInvestmentIncomeTax: Cited<{ rate: number; threshold: ByStatus<number> }>;
  qbi: Cited<{ rate: number; threshold: ByStatus<number> }>;
  // The OBBBA deductions for tax years 2025 to 2028 (Schedule 1-A).
  obbba: Cited<{
    firstYear: number;
    lastYear: number;
    tips: ObbbaLine;
    overtime: ObbbaLine;
    carLoanInterest: ObbbaLine;
    step: number;
    senior: {
      perPerson: number;
      minAge: number;
      phaseOutFrom: NormalJoint;
      phaseOutRate: number;
      rule: string;
    };
  }>;
  savers: Cited<{
    taxYear: number;
    agiLimit: ByStatus<number>;
    maxContribution: number;
    lowestRate: number;
    iraDeadline: string;
    rule: string;
  }>;
  saversMatch: Cited<{
    firstYear: number;
    shownFrom: string;
    shownUntil: string;
    rate: number;
    maxContribution: number;
    phaseOut: ByStatus<readonly [number, number]>;
    rule: string;
  }>;
  rothCatchUp: Cited<{
    priorYearFicaWagesOver: number;
    requiredFrom: number;
    rule: string;
    overByCatchUpYear: Readonly<Record<number, number>>;
  }>;
  // Null: not allowed (married filing separately).
  studentLoanInterest: Cited<{
    max: number;
    phaseOut: Readonly<Record<FilingStatus, readonly [number, number] | null>>;
  }>;
  salt: Cited<{
    cap: { normal: number; marriedSeparate: number };
    phaseDownFrom: { normal: number; marriedSeparate: number };
    phaseDownRate: number;
    floor: { normal: number; marriedSeparate: number };
  }>;
  charity: Cited<{ floorShare: number; nonItemizer: NormalJoint }>;
  medical: Cited<{ floorShare: number }>;
  contributionLimits: Cited<{
    workplace: number;
    workplaceCatchUp50: number;
    workplaceCatchUp60to63: number;
    ira: number;
    iraCatchUp50: number;
    hsaSelf: number;
    hsaFamily: number;
    hsaCatchUp55: number;
    healthFsa: number;
    dependentCareFsa: number;
    dependentCareFsaMarriedSeparate: number;
  }>;
  // The child and dependent care credit (OBBBA, from 2026).
  dependentCare: Cited<{
    costLimit: readonly [number, number];
    topShare: number;
    middleShare: number;
    bottomShare: number;
    firstStepFrom: number;
    secondStepFrom: NormalJoint;
    stepSize: NormalJoint;
  }>;
  education: Cited<{
    aotcMax: number;
    llcRate: number;
    llcCostLimit: number;
    phaseOut: {
      single: readonly [number, number];
      married_joint: readonly [number, number];
    };
  }>;
  // Tax year 2025 home energy credits, kept here until the 2025 file exists (T3).
  energy: Cited<{
    rate: number;
    improvementCap: number;
    heatPumpCap: number;
    homeEnds: string;
    vehicleEnds: string;
  }>;
  amt: Cited<{
    exemption: ByStatus<number>;
    phaseOutStart: ByStatus<number>;
    phaseOutRate: number;
    lowRate: number;
    highRate: number;
    highRateFrom: ByStatus<number>;
  }>;
  // Cents per mile (72.5, not 7,250).
  mileage: Cited<{
    businessCentsPerMile: number;
    businessByPeriod: readonly { from: string; to: string; centsPerMile: number }[];
  }>;
  homeOffice: Cited<{ perSquareFoot: number; maxSquareFeet: number }>;
}>;

type ObbbaLine = {
  max: NormalJoint;
  phaseOutFrom: NormalJoint;
  cutPerStep: number;
  joint: boolean;
  rule: string;
};
