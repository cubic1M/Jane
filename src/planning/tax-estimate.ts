import type { FilingStatus } from "@/config/tax";
import {
  ADDITIONAL_MEDICARE,
  CAPITAL_LOSS_LIMIT,
  CAPITAL_GAINS_BRACKETS,
  CHILD_TAX_CREDIT,
  EITC,
  FEDERAL_BRACKETS,
  ITEMIZED,
  NET_INVESTMENT_INCOME_TAX,
  QBI,
  SELF_EMPLOYMENT_TAX,
  STANDARD_DEDUCTION,
  STUDENT_LOAN_INTEREST,
  type Bracket,
} from "@/config/tax-rates";
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
// credits she has no data for) and says what it assumed.

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

export const marginalRateOf = (incomeCents: number, brackets: readonly Bracket[]) =>
  [...brackets].reverse().find((b) => incomeCents > b.over)?.rate ?? brackets[0].rate;

// Ordinary tax, with qualified dividends and long-term gains stacked on top at 0/15/20%.
export function incomeTax(
  taxableCents: number,
  preferentialCents: number,
  status: FilingStatus,
): number {
  const preferential = Math.min(clamp0(preferentialCents), clamp0(taxableCents));
  const ordinary = clamp0(taxableCents) - preferential;
  const ordinaryTax = bracketTax(ordinary, FEDERAL_BRACKETS[status]);
  if (preferential === 0) return ordinaryTax;
  const gains = CAPITAL_GAINS_BRACKETS[status];
  const stacked = bracketTax(ordinary + preferential, gains) - bracketTax(ordinary, gains);
  // Never more than taxing it all as ordinary income.
  return Math.min(
    ordinaryTax + stacked,
    bracketTax(clamp0(taxableCents), FEDERAL_BRACKETS[status]),
  );
}

export function selfEmploymentTax(netCents: number, socialSecurityWagesCents: number): number {
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
}) {
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
}): number {
  if (input.status === "married_separate") return 0;
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

function studentLoanDeduction(paidCents: number, magiCents: number, status: FilingStatus): number {
  const range = STUDENT_LOAN_INTEREST.phaseOut[status];
  if (!range) return 0;
  const base = Math.min(paidCents, STUDENT_LOAN_INTEREST.max);
  const [from, to] = range;
  if (magiCents <= from) return base;
  if (magiCents >= to) return 0;
  return round(base * (1 - (magiCents - from) / (to - from)));
}

function stateLocalCap(agiCents: number, status: FilingStatus): number {
  const separate = status === "married_separate";
  const cap = separate ? ITEMIZED.saltCap.marriedSeparate : ITEMIZED.saltCap.normal;
  const from = separate
    ? ITEMIZED.saltPhaseDownFrom.marriedSeparate
    : ITEMIZED.saltPhaseDownFrom.normal;
  const floor = separate ? ITEMIZED.saltFloor.marriedSeparate : ITEMIZED.saltFloor.normal;
  return Math.max(floor, cap - round(clamp0(agiCents - from) * ITEMIZED.saltPhaseDownRate));
}

// The state (and local) estimate: every state's part, totalled, against what was withheld
// and paid to the states. Named after the state lived in at the year's end.
export function stateEstimate(input: EstimateInput, agiCents: number): StateEstimate | null {
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
export function netCapital(stCents: number, ltCents: number, status: FilingStatus) {
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

export function estimateTaxes(input: EstimateInput): TaxEstimate {
  const status = input.filingStatus;
  const inc = input.income;
  const capital = netCapital(inc.shortTermGainsCents, inc.longTermGainsCents, status);
  const se = clamp0(inc.selfEmploymentCents);
  const seTax = selfEmploymentTax(se, inc.socialSecurityWagesCents);
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
  const beforeStudent = totalIncome - halfSe;
  const studentLoan = studentLoanDeduction(input.studentLoanInterestCents, beforeStudent, status);
  const agi = beforeStudent - studentLoan - (input.otherAdjustmentsCents ?? 0);

  const stateTaxSeen =
    input.stateWithheldCents + input.stateEstimatedPaidCents + input.otherStateLocalTaxCents;
  const itemized = {
    stateLocalTaxCents: Math.min(stateTaxSeen, stateLocalCap(agi, status)),
    mortgageInterestCents: input.mortgageInterestCents,
    charityCents: clamp0(input.charityCents - round(clamp0(agi) * ITEMIZED.charityFloorShare)),
    medicalCents: clamp0(input.medicalCents - round(clamp0(agi) * ITEMIZED.medicalFloorShare)),
  };
  const itemizedTotal = Object.values(itemized).reduce((a, b) => a + b, 0);
  const standard = STANDARD_DEDUCTION[status];
  const itemizes = itemizedTotal > standard;
  const nonItemizerCharity = itemizes
    ? 0
    : Math.min(
        input.charityCents,
        status === "married_joint"
          ? ITEMIZED.nonItemizerCharity.marriedJoint
          : ITEMIZED.nonItemizerCharity.normal,
      );
  const afterDeduction = clamp0(agi - (itemizes ? itemizedTotal : standard) - nonItemizerCharity);
  // QBI: 20% of self-employment income less half the SE tax, capped at 20% of taxable
  // income before it; only below the threshold, where its limits start.
  const preferential = inc.qualifiedDividendsCents + capital.longTermCents;
  const qbi =
    afterDeduction <= QBI.threshold[status]
      ? round(
          Math.min(
            clamp0(se - halfSe) * QBI.rate,
            clamp0(afterDeduction - preferential) * QBI.rate,
          ),
        )
      : 0;
  const taxable = clamp0(afterDeduction - qbi);

  const ordinaryTax = incomeTax(taxable, preferential, status);
  const earned = inc.wagesCents + clamp0(se - halfSe);
  const addlMedicare = round(
    clamp0(
      inc.wagesCents +
        se * SELF_EMPLOYMENT_TAX.netEarningsShare -
        ADDITIONAL_MEDICARE.threshold[status],
    ) * ADDITIONAL_MEDICARE.rate,
  );
  const investmentIncome =
    inc.interestCents + inc.dividendsCents + clamp0(capital.incomeCents) + inc.rentalCents;
  const niit = round(
    Math.min(clamp0(investmentIncome), clamp0(agi - NET_INVESTMENT_INCOME_TAX.threshold[status])) *
      NET_INVESTMENT_INCOME_TAX.rate,
  );
  const child = childCredits({
    status,
    children: input.childrenUnder17,
    others: input.otherDependants,
    agiCents: agi,
    earnedCents: earned,
    taxBeforeCreditsCents: ordinaryTax,
  });
  const eitc = earnedIncomeCredit({
    status,
    children: input.childrenUnder17,
    earnedCents: earned,
    agiCents: agi,
    investmentIncomeCents: investmentIncome,
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
          taxableCents: taxable,
          addBackCents: itemizes ? itemized.stateLocalTaxCents : standard,
          preferenceCents: input.amtPreferenceCents!,
          regularTaxCents: ordinaryTax,
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
    totalIncomeCents: totalIncome,
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
      FEDERAL_BRACKETS[status],
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
