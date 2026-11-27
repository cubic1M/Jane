import { socialSecurityTax } from "./retirement-taxes";
import type { FilingStatus } from "@/config/tax";
import { federalParams } from "@/config/tax-params";
import { TAX_RATES_YEAR, type Bracket } from "@/config/tax-rates";
import { amt } from "@/planning/equity-tax";
import { bracketTax } from "@/planning/tax-brackets";
import {
  residentTax,
  stateParts,
  type LocalPart,
  type Residency,
  type StatePart,
} from "@/planning/tax-states";

export { bracketTax };

// The tax estimate (spec step 120): federal and state tax for a year from the person's
// income and profile, with every figure in cents and every one an estimate. Pure. It's a
// planning estimate, not a return: it leaves out what Jane can't see (property tax, most
// credits it has no data for) and says what it assumed.

export type EstimateIncome = {
  // Box 1 wages: gross pay less pre-tax retirement and health deductions.
  wagesCents: number;
  // Wages subject to Social Security, for the self-employment tax cap.
  socialSecurityWagesCents: number;
  // Self-employment: money in less business expenses (step 123).
  selfEmploymentCents: number;
  interestCents: number;
  // Ordinary dividends, including any qualified ones.
  dividendsCents: number;
  qualifiedDividendsCents: number;
  shortTermGainsCents: number;
  longTermGainsCents: number;
  rentalCents: number;
  retirementCents: number;
  unemploymentCents: number;
  // Spec step 173: side income that is a hobby: taxed, with no expenses and no
  // self-employment tax.
  otherCents?: number;
  // Social Security benefits for the year (taxes QA): only the part Publication 915 makes
  // taxable at the other income counts.
  socialSecurityBenefitsCents?: number;
};

export const NO_INCOME: EstimateIncome = {
  wagesCents: 0,
  socialSecurityWagesCents: 0,
  selfEmploymentCents: 0,
  interestCents: 0,
  dividendsCents: 0,
  qualifiedDividendsCents: 0,
  shortTermGainsCents: 0,
  longTermGainsCents: 0,
  rentalCents: 0,
  retirementCents: 0,
  unemploymentCents: 0,
};

export type EstimateInput = {
  year: number;
  filingStatus: FilingStatus;
  childrenUnder17: number;
  otherDependants: number;
  // Age at the end of the year, when the person has told it; null or absent: unknown.
  age?: number | null;
  // Two-letter state, or null when it isn't known: where the person lives at the year's end.
  state: string | null;
  // Spec step 165: moves in the year, remote work for an employer in another state, and a
  // city or county income tax. Left out: one state all year, no local tax.
  residency?: Residency;
  income: EstimateIncome;
  // Adjustments and deductions Jane can see.
  studentLoanInterestCents: number;
  // Other above-the-line adjustments (an IRA deduction, an HSA contribution outside
  // payroll): step 122's what-ifs.
  otherAdjustmentsCents?: number;
  // Credits Jane works out elsewhere (education, dependent care), not refundable.
  otherCreditsCents?: number;
  // Spec step 219: the alternative minimum tax preference from ISOs exercised and held.
  amtPreferenceCents?: number;
  // False when the person has not said they are a citizen or green card holder: the earned income
  // credit (resident-only, IRS Pub. 519) is then left out of this estimate. Absent means true, so
  // every caller that does not know keeps today's figure.
  residentCreditsAllowed?: boolean;
  mortgageInterestCents: number;
  charityCents: number;
  medicalCents: number;
  // Property and other state and local taxes the person paid (not withholding).
  otherStateLocalTaxCents: number;
  // Tax already paid toward the year.
  federalWithheldCents: number;
  federalEstimatedPaidCents: number;
  stateWithheldCents: number;
  stateEstimatedPaidCents: number;
};

export type StateEstimate = {
  code: string;
  kind: "none" | "flat" | "brackets" | "approximate";
  taxableCents: number;
  taxCents: number;
  paidCents: number;
  // Positive: a refund. Negative: owed.
  refundCents: number;
  source: string;
  // Figures not confirmed for the year, or a rough rate.
  rough: boolean;
  // Spec step 165: each state that taxes some of the income (one for most people), and
  // the local income tax. taxCents above is their total.
  parts: StatePart[];
  local: LocalPart | null;
};

export type TaxEstimate = {
  year: number;
  filingStatus: FilingStatus;
  totalIncomeCents: number;
  // The part of Social Security counted in income (taxes QA).
  socialSecurityTaxableCents: number;
  adjustments: { halfSelfEmploymentTaxCents: number; studentLoanInterestCents: number };
  agiCents: number;
  deduction: {
    kind: "standard" | "itemized";
    standardCents: number;
    itemizedCents: number;
    itemized: {
      stateLocalTaxCents: number;
      mortgageInterestCents: number;
      charityCents: number;
      medicalCents: number;
    };
    // Cash gifts non-itemizers can deduct (OBBBA, from 2026).
    nonItemizerCharityCents: number;
  };
  qbiCents: number;
  taxableCents: number;
  // The rate on the next dollar of ordinary income.
  marginalRate: number;
  incomeTaxCents: number;
  selfEmploymentTaxCents: number;
  additionalMedicareCents: number;
  netInvestmentIncomeTaxCents: number;
  // Spec step 219: the alternative minimum tax, on top of the regular tax.
  amtCents: number;
  credits: {
    childTaxCreditCents: number;
    otherDependantCreditCents: number;
    // Refundable parts.
    additionalChildTaxCreditCents: number;
    earnedIncomeCreditCents: number;
  };
  totalTaxCents: number;
  paidCents: number;
  // Positive: a refund. Negative: owed.
  refundCents: number;
  state: StateEstimate | null;
};

const round = (cents: number) => Math.round(cents);
const clamp0 = (cents: number) => Math.max(0, cents);

// The rate on the next dollar: at exactly a bracket's start that is the bracket that starts there
// (Pub. 505 Tax Rate Schedules: "over $12,400" is taxed at 12% from the first dollar above it).
export const marginalRateOf = (incomeCents: number, brackets: readonly Bracket[]) =>
  [...brackets].reverse().find((b) => incomeCents >= b.over)?.rate ?? brackets[0].rate;

// Ordinary tax, with qualified dividends and long-term gains stacked on top at 0/15/20%.
// `year` is the tax year's law (federalParams throws NoTaxParamsError for a year with none). The
// default is only for callers that have not been moved to pass their own year.
export function incomeTax(
  taxableCents: number,
  preferentialCents: number,
  status: FilingStatus,
  year: number = TAX_RATES_YEAR,
): number {
  const p = federalParams(year);
  const preferential = Math.min(clamp0(preferentialCents), clamp0(taxableCents));
  const ordinary = clamp0(taxableCents) - preferential;
  const ordinaryTax = bracketTax(ordinary, p.brackets.value[status]);
  if (preferential === 0) return ordinaryTax;
  const gains = p.capitalGains.value[status];
  const stacked = bracketTax(ordinary + preferential, gains) - bracketTax(ordinary, gains);
  // Never more than taxing it all as ordinary income.
  return Math.min(
    ordinaryTax + stacked,
    bracketTax(clamp0(taxableCents), p.brackets.value[status]),
  );
}

export function selfEmploymentTax(
  netCents: number,
  socialSecurityWagesCents: number,
  year: number = TAX_RATES_YEAR,
): number {
  const SELF_EMPLOYMENT_TAX = federalParams(year).selfEmployment.value;
  const earnings = netCents * SELF_EMPLOYMENT_TAX.netEarningsShare;
  if (earnings < SELF_EMPLOYMENT_TAX.minimumNetEarnings) return 0;
  const ssBase = clamp0(
    Math.min(earnings, SELF_EMPLOYMENT_TAX.wageBase - socialSecurityWagesCents),
  );
  return round(
    ssBase * SELF_EMPLOYMENT_TAX.socialSecurityRate + earnings * SELF_EMPLOYMENT_TAX.medicareRate,
  );
}

// The child tax credit and credit for other dependants, after the phase-out; and the
// refundable part (additional child tax credit) of what the tax didn't use.
export function childCredits(input: {
  status: FilingStatus;
  children: number;
  others: number;
  agiCents: number;
  earnedCents: number;
  taxBeforeCreditsCents: number;
  year?: number;
}) {
  const CHILD_TAX_CREDIT = federalParams(input.year ?? TAX_RATES_YEAR).ctc.value;
  const full =
    input.children * CHILD_TAX_CREDIT.perChild + input.others * CHILD_TAX_CREDIT.otherDependant;
  const over = clamp0(input.agiCents - CHILD_TAX_CREDIT.phaseOutFrom[input.status]);
  const cut = Math.ceil(over / CHILD_TAX_CREDIT.phaseOutStep) * CHILD_TAX_CREDIT.phaseOutPerStep;
  const allowed = clamp0(full - cut);
  // Children first, then others, against the tax.
  const childPart = Math.min(allowed, input.children * CHILD_TAX_CREDIT.perChild);
  const otherPart = allowed - childPart;
  const usedOther = Math.min(otherPart, clamp0(input.taxBeforeCreditsCents));
  const usedChild = Math.min(childPart, clamp0(input.taxBeforeCreditsCents - usedOther));
  const refundable = Math.min(
    childPart - usedChild,
    input.children * CHILD_TAX_CREDIT.refundablePerChild,
    round(
      clamp0(input.earnedCents - CHILD_TAX_CREDIT.earnedIncomeFloor) *
        CHILD_TAX_CREDIT.refundableRate,
    ),
  );
  return { childCents: usedChild, otherCents: usedOther, refundableCents: clamp0(refundable) };
}

export function earnedIncomeCredit(input: {
  status: FilingStatus;
  children: number;
  earnedCents: number;
  agiCents: number;
  investmentIncomeCents: number;
  // Age at the end of the year; without children the credit is only for 25 to 64, so an
  // unknown age counts none.
  age?: number | null;
  year?: number;
}): number {
  const EITC = federalParams(input.year ?? TAX_RATES_YEAR).eitc.value;
  if (input.status === "married_separate") return 0;
  if (
    input.children === 0 &&
    (input.age == null || input.age < EITC.childlessMinAge || input.age > EITC.childlessMaxAge)
  )
    return 0;
  if (input.investmentIncomeCents > EITC.investmentIncomeLimit) return 0;
  const n = Math.min(3, Math.max(0, input.children));
  const phaseIn = Math.min(EITC.maxCredit[n], input.earnedCents * EITC.phaseInRate[n]);
  const from = (
    input.status === "married_joint" ? EITC.phaseOutFrom.married_joint : EITC.phaseOutFrom.single
  )[n];
  const income = Math.max(input.earnedCents, input.agiCents);
  const credit = Math.min(
    phaseIn,
    EITC.maxCredit[n] - clamp0(income - from) * EITC.phaseOutRate[n],
  );
  return clamp0(round(credit));
}

function studentLoanDeduction(
  paidCents: number,
  magiCents: number,
  status: FilingStatus,
  year: number,
): number {
  const STUDENT_LOAN_INTEREST = federalParams(year).studentLoanInterest.value;
  const range = STUDENT_LOAN_INTEREST.phaseOut[status];
  if (!range) return 0;
  const base = Math.min(paidCents, STUDENT_LOAN_INTEREST.max);
  const [from, to] = range;
  if (magiCents <= from) return base;
  if (magiCents >= to) return 0;
  return round(base * (1 - (magiCents - from) / (to - from)));
}

function stateLocalCap(agiCents: number, status: FilingStatus, year: number): number {
  const salt = federalParams(year).salt.value;
  const separate = status === "married_separate";
  const cap = separate ? salt.cap.marriedSeparate : salt.cap.normal;
  const from = separate ? salt.phaseDownFrom.marriedSeparate : salt.phaseDownFrom.normal;
  const floor = separate ? salt.floor.marriedSeparate : salt.floor.normal;
  // 26 USC 164(b)(7)(B) cuts the whole-return limit by 30% of the excess over the threshold (halved
  // for a separate return), never below $10,000; (b)(6)(B) then halves the result for a separate
  // return. The halving comes after the cut, so a separate return loses 15 cents of cap per dollar.
  const rate = separate ? salt.phaseDownRate / 2 : salt.phaseDownRate;
  return Math.max(floor, cap - round(clamp0(agiCents - from) * rate));
}

// The state (and local) estimate: every state's part, totalled, against what was withheld
// and paid to the states. Named after the state lived in at the year's end.
function stateEstimate(input: EstimateInput, agiCents: number): StateEstimate | null {
  if (!input.state && !input.residency?.moves.length) return null;
  const { parts, local } = stateParts({
    year: input.year,
    state: input.state,
    residency: input.residency,
    who: input,
    agiCents,
    wagesCents: input.income.wagesCents,
  });
  const home = parts.filter((p) => p.residence !== "nonresident").at(-1) ?? parts.at(-1) ?? null;
  if (!home) return null;
  const paid = input.stateWithheldCents + input.stateEstimatedPaidCents;
  const tax = parts.reduce((s, p) => s + p.taxCents, 0) + (local?.taxCents ?? 0);
  return {
    code: home.code,
    kind: home.kind !== "none" ? home.kind : (parts.find((p) => p.kind !== "none")?.kind ?? "none"),
    // As if a resident all year: each part's share is of this.
    taxableCents: residentTax(home.code, clamp0(agiCents), input)?.taxableCents ?? 0,
    taxCents: tax,
    paidCents: paid,
    refundCents: paid - tax,
    source: home.source,
    rough: parts.some((p) => p.rough),
    parts,
    local,
  };
}

// Spec step 124: short- and long-term gains netted. A net gain counts as income, its long-
// term part (up to the net) at the capital gains rates; a net loss comes off income only up
// to the limit.
function netCapital(stCents: number, ltCents: number, status: FilingStatus, year: number) {
  const CAPITAL_LOSS_LIMIT = federalParams(year).capitalLoss.value;
  const net = stCents + ltCents;
  if (net < 0) {
    const limit =
      status === "married_separate"
        ? CAPITAL_LOSS_LIMIT.marriedSeparate
        : CAPITAL_LOSS_LIMIT.normal;
    return { incomeCents: Math.max(net, -limit), longTermCents: 0 };
  }
  return { incomeCents: net, longTermCents: Math.max(0, Math.min(ltCents, net)) };
}

// Prices the year in input.year with that year's law; throws NoTaxParamsError for a year Jane has no
// figures for (never another year's figures).
export function estimateTaxes(input: EstimateInput): TaxEstimate {
  const P = federalParams(input.year);
  const status = input.filingStatus;
  const inc = input.income;
  const capital = netCapital(inc.shortTermGainsCents, inc.longTermGainsCents, status, input.year);
  const se = clamp0(inc.selfEmploymentCents);
  const seTax = selfEmploymentTax(se, inc.socialSecurityWagesCents, input.year);
  const halfSe = round(seTax / 2);
  const totalIncome =
    inc.wagesCents +
    inc.selfEmploymentCents +
    inc.interestCents +
    inc.dividendsCents +
    capital.incomeCents +
    inc.rentalCents +
    inc.retirementCents +
    inc.unemploymentCents +
    (inc.otherCents ?? 0);
  // Taxes QA: Social Security's taxable part, from provisional income (step 271's rule).
  const ssTaxable = inc.socialSecurityBenefitsCents
    ? socialSecurityTax({
        benefitsCents: inc.socialSecurityBenefitsCents,
        otherIncomeCents: totalIncome - halfSe,
        status: status === "married_joint" ? "married_joint" : "single",
      }).taxableCents
    : 0;
  const beforeStudent = totalIncome + ssTaxable - halfSe;
  const studentLoan = studentLoanDeduction(
    input.studentLoanInterestCents,
    beforeStudent,
    status,
    input.year,
  );
  const agi = beforeStudent - studentLoan - (input.otherAdjustmentsCents ?? 0);

  const stateTaxSeen =
    input.stateWithheldCents + input.stateEstimatedPaidCents + input.otherStateLocalTaxCents;
  const itemized = {
    stateLocalTaxCents: Math.min(stateTaxSeen, stateLocalCap(agi, status, input.year)),
    mortgageInterestCents: input.mortgageInterestCents,
    charityCents: clamp0(input.charityCents - round(clamp0(agi) * P.charity.value.floorShare)),
    medicalCents: clamp0(input.medicalCents - round(clamp0(agi) * P.medical.value.floorShare)),
  };
  const itemizedTotal = Object.values(itemized).reduce((a, b) => a + b, 0);
  const standard = P.standardDeduction.value[status];
  const itemizes = itemizedTotal > standard;
  const nonItemizerCharity = itemizes
    ? 0
    : Math.min(
        input.charityCents,
        status === "married_joint"
          ? P.charity.value.nonItemizer.marriedJoint
          : P.charity.value.nonItemizer.normal,
      );
  const beforeClamp = agi - (itemizes ? itemizedTotal : standard) - nonItemizerCharity;
  const afterDeduction = clamp0(beforeClamp);
  // QBI: 20% of self-employment income less half the SE tax, capped at 20% of taxable
  // income before it; only below the threshold, where its limits start.
  const preferential = inc.qualifiedDividendsCents + capital.longTermCents;
  const qbi =
    afterDeduction <= P.qbi.value.threshold[status]
      ? round(
          Math.min(
            clamp0(se - halfSe) * P.qbi.value.rate,
            clamp0(afterDeduction - preferential) * P.qbi.value.rate,
          ),
        )
      : 0;
  const taxable = clamp0(afterDeduction - qbi);
  // What AMT starts from keeps a negative: an unused deduction is added back whole (Form 6251 line 1b).
  const taxableBeforeClamp = beforeClamp - qbi;

  const ordinaryTax = incomeTax(taxable, preferential, status, input.year);
  const earned = inc.wagesCents + clamp0(se - halfSe);
  const addlMedicare = round(
    clamp0(
      inc.wagesCents +
        se * P.selfEmployment.value.netEarningsShare -
        P.additionalMedicare.value.threshold[status],
    ) * P.additionalMedicare.value.rate,
  );
  const investmentIncome =
    inc.interestCents + inc.dividendsCents + clamp0(capital.incomeCents) + inc.rentalCents;
  const niit = round(
    Math.min(
      clamp0(investmentIncome),
      clamp0(agi - P.netInvestmentIncomeTax.value.threshold[status]),
    ) * P.netInvestmentIncomeTax.value.rate,
  );
  const child = childCredits({
    status,
    children: input.childrenUnder17,
    others: input.otherDependants,
    agiCents: agi,
    earnedCents: earned,
    taxBeforeCreditsCents: ordinaryTax,
    year: input.year,
  });
  const eitc =
    input.residentCreditsAllowed === false
      ? 0
      : earnedIncomeCredit({
          status,
          children: input.childrenUnder17,
          earnedCents: earned,
          agiCents: agi,
          investmentIncomeCents: investmentIncome,
          age: input.age,
          year: input.year,
        });
  const otherCredits = Math.min(
    input.otherCreditsCents ?? 0,
    clamp0(ordinaryTax - child.childCents - child.otherCents),
  );
  // Spec step 219: the alternative minimum tax, when there's a preference to count.
  const amtResult =
    (input.amtPreferenceCents ?? 0) > 0
      ? amt({
          status,
          taxableCents: taxableBeforeClamp,
          addBackCents: itemizes ? itemized.stateLocalTaxCents : standard,
          preferenceCents: input.amtPreferenceCents!,
          regularTaxCents: ordinaryTax,
          // Form 6251 line 13 carries the gains and qualified dividends whole (not capped at regular
          // taxable income, which may be zero below the standard deduction); amt() caps them at its
          // own base. The regular ordinary income under them (line 20) stays the clamped figure.
          preferentialCents: preferential,
          regularOrdinaryCents: taxable - Math.min(preferential, taxable),
          year: input.year,
        })
      : { amtCents: 0 };
  const totalTax =
    amtResult.amtCents +
    ordinaryTax -
    child.childCents -
    child.otherCents -
    otherCredits +
    seTax +
    addlMedicare +
    niit -
    child.refundableCents -
    eitc;
  const paid = input.federalWithheldCents + input.federalEstimatedPaidCents;

  return {
    year: input.year,
    filingStatus: status,
    totalIncomeCents: totalIncome + ssTaxable,
    socialSecurityTaxableCents: ssTaxable,
    adjustments: { halfSelfEmploymentTaxCents: halfSe, studentLoanInterestCents: studentLoan },
    agiCents: agi,
    deduction: {
      kind: itemizes ? "itemized" : "standard",
      standardCents: standard,
      itemizedCents: itemizedTotal,
      itemized,
      nonItemizerCharityCents: nonItemizerCharity,
    },
    qbiCents: qbi,
    taxableCents: taxable,
    marginalRate: marginalRateOf(
      taxable - Math.min(preferential, taxable),
      P.brackets.value[status],
    ),
    incomeTaxCents: ordinaryTax,
    selfEmploymentTaxCents: seTax,
    additionalMedicareCents: addlMedicare,
    netInvestmentIncomeTaxCents: niit,
    amtCents: amtResult.amtCents,
    credits: {
      childTaxCreditCents: child.childCents,
      otherDependantCreditCents: child.otherCents,
      additionalChildTaxCreditCents: child.refundableCents,
      earnedIncomeCreditCents: eitc,
    },
    totalTaxCents: totalTax,
    paidCents: paid,
    refundCents: paid - totalTax,
    state: stateEstimate(input, agi),
  };
}
