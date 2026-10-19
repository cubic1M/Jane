import { FAMILY_MIN_SAVING_CENTS, FAMILY_RULES } from "@/config/family-taxes";
import { STATE_529 } from "@/config/college";
import {
  CONTRIBUTION_LIMITS,
  DEPENDENT_CARE_CREDIT,
  EDUCATION_CREDITS,
  PAYROLL_TAX,
} from "@/config/tax-rates";
import type { FilingStatus } from "@/config/tax";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "@/planning/tax-estimate";
import { careShare, phaseOut } from "@/planning/tax-savings";
import { residentTax } from "@/planning/tax-states";

// Family taxes (spec step 169). Pure. Each choice is shown as both sides' tax from the
// estimate engine: claiming the children or not, a dependent care FSA or the credit, the
// American Opportunity or Lifetime Learning credit, a 529 contribution's state break, and
// married filing jointly or separately (head of household or single). Each side lists the
// eligibility rules it depends on; a side the person isn't eligible for says why.

export type Side = {
  label: string;
  // Federal income tax, plus what differs between the sides (payroll tax for an FSA,
  // state tax for a 529).
  taxCents: number;
  eligible: boolean;
  why: string[];
};

export type FamilyChoice = {
  key: "children" | "care" | "education" | "plan529" | "filing";
  title: string;
  sides: [Side, Side];
  // The side with less tax among those eligible (0 or 1), or null when neither is.
  better: 0 | 1 | null;
  savesCents: number;
};

const federal = (input: EstimateInput) => estimateTaxes(input).totalTaxCents;
const choice = (key: FamilyChoice["key"], title: string, sides: [Side, Side]): FamilyChoice => {
  const [a, b] = sides;
  const better =
    a.eligible && b.eligible
      ? a.taxCents <= b.taxCents
        ? 0
        : 1
      : a.eligible
        ? 0
        : b.eligible
          ? 1
          : null;
  const savesCents = a.eligible && b.eligible ? Math.abs(a.taxCents - b.taxCents) : 0;
  return { key, title, sides, better, savesCents };
};

// --- Eligibility rules ---

export type Child = {
  ageAtYearEnd: number;
  hasSsn: boolean;
  monthsLivedWithYou: number;
};

export function childCreditRules(c: Child): string[] {
  const why: string[] = [];
  if (c.ageAtYearEnd >= FAMILY_RULES.childCreditUnderAge) {
    why.push(`They're ${c.ageAtYearEnd} at the end of the year; the credit is for under 17.`);
  }
  if (!c.hasSsn) why.push("They need a Social Security number by the filing deadline.");
  if (c.monthsLivedWithYou <= FAMILY_RULES.halfYearMonths) {
    why.push("They must live with you more than half the year.");
  }
  return why;
}

export function careRules(input: {
  children: Child[];
  status: FilingStatus;
  bothWork: boolean;
}): string[] {
  const why: string[] = [];
  if (!input.children.some((c) => c.ageAtYearEnd < FAMILY_RULES.careUnderAge)) {
    why.push("Care counts for a child under 13.");
  }
  if (input.status === "married_joint" && !input.bothWork) {
    why.push("When you're married, you both need to work (or look for work, or study).");
  }
  if (input.status === "married_separate") {
    why.push("Married filing separately generally can't claim the care credit.");
  }
  return why;
}

export type Student = { yearsOfCollegeBefore: number; halfTime: boolean };

export function aotcRules(s: Student, status: FilingStatus): string[] {
  const why: string[] = [];
  if (s.yearsOfCollegeBefore >= FAMILY_RULES.aotcYears) {
    why.push("It's only for the first four years of college.");
  }
  if (!s.halfTime) why.push("The student must be at least half-time.");
  if (status === "married_separate") why.push("Married filing separately can't claim it.");
  return why;
}

export const llcRules = (status: FilingStatus): string[] =>
  status === "married_separate" ? ["Married filing separately can't claim it."] : [];

export function headOfHouseholdRules(input: {
  married: boolean;
  paysOverHalfHome: boolean;
  qualifyingPerson: boolean;
}): string[] {
  const why: string[] = [];
  if (input.married) why.push("You must be unmarried at the end of the year.");
  if (!input.paysOverHalfHome)
    why.push("You must pay more than half the cost of keeping up your home.");
  if (!input.qualifyingPerson) {
    why.push("A qualifying child or relative must live with you more than half the year.");
  }
  return why;
}

// --- The choices ---

export function childrenChoice(input: EstimateInput, children: Child[]): FamilyChoice | null {
  if (children.length === 0) return null;
  const qualifying = children.filter((c) => childCreditRules(c).length === 0).length;
  const others = children.length - qualifying;
  const why = children.flatMap(childCreditRules);
  return choice("children", "Claiming your children", [
    {
      label: `Claim ${children.length === 1 ? "your child" : `your ${children.length} children`}`,
      taxCents: federal({ ...input, childrenUnder17: qualifying, otherDependants: others }),
      eligible: true,
      why: why.length > 0 ? why : ["Each qualifies for the child tax credit."],
    },
    {
      label: "Don't claim them (someone else does)",
      taxCents: federal({ ...input, childrenUnder17: 0, otherDependants: 0 }),
      eligible: true,
      why: ["Only one person can claim each child; usually the parent they lived with most."],
    },
  ]);
}

export function careChoice(input: {
  estimate: EstimateInput;
  careCents: number;
  children: Child[];
  bothWork: boolean;
}): FamilyChoice | null {
  const base = input.estimate;
  if (input.careCents <= 0) return null;
  const why = careRules({
    children: input.children,
    status: base.filingStatus,
    bothWork: input.bothWork,
  });
  const eligible = why.length === 0;
  const kids = input.children.filter((c) => c.ageAtYearEnd < FAMILY_RULES.careUnderAge).length;
  const costLimit = DEPENDENT_CARE_CREDIT.costLimit[kids > 1 ? 1 : 0];
  const fsaLimit =
    base.filingStatus === "married_separate"
      ? CONTRIBUTION_LIMITS.dependentCareFsaMarriedSeparate
      : CONTRIBUTION_LIMITS.dependentCareFsa;
  const jointly = base.filingStatus === "married_joint";
  const payrollRate = PAYROLL_TAX.socialSecurityRate + PAYROLL_TAX.medicareRate;

  // FSA: the care paid from it comes off wages (and payroll tax); the credit's cost limit
  // goes down by it.
  const fsa = Math.min(input.careCents, fsaLimit);
  const fsaInput = {
    ...base,
    income: {
      ...base.income,
      wagesCents: base.income.wagesCents - fsa,
      socialSecurityWagesCents: base.income.socialSecurityWagesCents - fsa,
    },
  };
  const agiWithFsa = estimateTaxes(fsaInput).agiCents;
  const leftOver = Math.max(0, Math.min(input.careCents - fsa, costLimit - fsa));
  const fsaCredit = Math.round(leftOver * careShare(agiWithFsa, jointly));
  const withFsa =
    federal({ ...fsaInput, otherCreditsCents: (base.otherCreditsCents ?? 0) + fsaCredit }) -
    Math.round(fsa * payrollRate);

  const agi = estimateTaxes(base).agiCents;
  const credit = Math.round(Math.min(input.careCents, costLimit) * careShare(agi, jointly));
  const withCredit = federal({
    ...base,
    otherCreditsCents: (base.otherCreditsCents ?? 0) + credit,
  });

  return choice("care", "Childcare: a dependent care FSA or the credit", [
    {
      label: `Pay ${dollars(fsa)} of care from a dependent care FSA`,
      taxCents: withFsa,
      eligible,
      why: eligible
        ? [
            `Up to ${dollars(fsaLimit)} a year skips income and payroll tax (the figure counts the payroll tax saved).`,
          ]
        : why,
    },
    {
      label: `Claim the credit on ${dollars(Math.min(input.careCents, costLimit))} of care`,
      taxCents: withCredit,
      eligible,
      why: eligible
        ? [
            `${Math.round(careShare(agi, jointly) * 100)}% of up to ${dollars(costLimit)} of care at your income.`,
          ]
        : why,
    },
  ]);
}

export function educationChoice(input: {
  estimate: EstimateInput;
  tuitionCents: number;
  student: Student;
}): FamilyChoice | null {
  const base = input.estimate;
  if (input.tuitionCents <= 0) return null;
  const status = base.filingStatus;
  const range =
    status === "married_joint"
      ? EDUCATION_CREDITS.phaseOut.married_joint
      : EDUCATION_CREDITS.phaseOut.single;
  const agi = estimateTaxes(base).agiCents;
  const r = FAMILY_RULES;
  const aotcFull = Math.min(
    EDUCATION_CREDITS.aotcMax,
    Math.min(input.tuitionCents, r.aotcFirstCents) +
      Math.round(
        Math.max(0, Math.min(input.tuitionCents - r.aotcFirstCents, r.aotcSecondCents)) *
          r.aotcSecondRate,
      ),
  );
  const aotc = phaseOut(aotcFull, agi, range as [number, number]);
  const refundable = Math.round(aotc * r.aotcRefundableShare);
  const llc = phaseOut(
    Math.round(
      Math.min(input.tuitionCents, EDUCATION_CREDITS.llcCostLimit) * EDUCATION_CREDITS.llcRate,
    ),
    agi,
    range as [number, number],
  );
  // The refundable 40% of the AOTC comes off even when there's no tax left.
  const withAotc =
    federal({ ...base, otherCreditsCents: (base.otherCreditsCents ?? 0) + aotc - refundable }) -
    refundable;
  const withLlc = federal({ ...base, otherCreditsCents: (base.otherCreditsCents ?? 0) + llc });
  const aotcWhy = aotcRules(input.student, status);
  const llcWhy = llcRules(status);
  return choice("education", "Tuition: which education credit fits", [
    {
      label: `American Opportunity Credit (${dollars(aotc)})`,
      taxCents: withAotc,
      eligible: aotcWhy.length === 0,
      why:
        aotcWhy.length > 0
          ? aotcWhy
          : ["100% of the first $2,000 of tuition and 25% of the next $2,000; 40% is refundable."],
    },
    {
      label: `Lifetime Learning Credit (${dollars(llc)})`,
      taxCents: withLlc,
      eligible: llcWhy.length === 0,
      why: llcWhy.length > 0 ? llcWhy : ["20% of up to $10,000 of tuition, any year of study."],
    },
  ]);
}

// A 529 contribution's state break (step 158's STATE_529): the state tax with the
// contribution deducted (or credited) and without. No federal deduction either way.
export function plan529Choice(input: {
  estimate: EstimateInput;
  state: string | null;
  contributionCents: number;
}): FamilyChoice | null {
  const base = input.estimate;
  const rule = input.state ? STATE_529[input.state] : undefined;
  if (!input.state || !rule || input.contributionCents <= 0) return null;
  const agi = estimateTaxes(base).agiCents;
  const who = base;
  const stateTax = (income: number) => residentTax(input.state!, income, who)?.taxCents ?? 0;
  const fed = federal(base);
  const jointly = base.filingStatus === "married_joint";
  const cap = jointly
    ? (rule.jointDeductionCents ?? rule.deductionCents ?? 0)
    : (rule.deductionCents ?? 0);
  const deduction = Math.min(input.contributionCents, cap);
  const credit = rule.creditRate
    ? Math.min(
        Math.round(input.contributionCents * rule.creditRate),
        rule.creditCapCents ?? Infinity,
      )
    : 0;
  const withIt = fed + Math.max(0, stateTax(agi - deduction) - credit);
  const without = fed + stateTax(agi);
  return choice("plan529", `Saving ${dollars(input.contributionCents)} in a 529`, [
    {
      label: rule.anyPlan ? "In any state's 529 plan" : "In your state's own 529 plan",
      taxCents: withIt,
      eligible: true,
      why: [
        credit > 0
          ? `Your state gives a credit of ${dollars(credit)}.`
          : `Your state lets you deduct up to ${dollars(cap)}.`,
      ],
    },
    {
      label: "In a taxable account instead",
      taxCents: without,
      eligible: true,
      why: ["No state break, and its growth is taxed."],
    },
  ]);
}

// Couples: jointly (both incomes on one return) or separately (each on their own; the
// children with the person). Unmarried with a dependant: head of household or single.
export function filingChoice(input: {
  estimate: EstimateInput;
  married: boolean;
  spouseWagesCents: number;
  paysOverHalfHome: boolean;
}): FamilyChoice | null {
  const base = input.estimate;
  if (input.married) {
    const joint = federal({
      ...base,
      filingStatus: "married_joint",
      income: {
        ...base.income,
        wagesCents: base.income.wagesCents + input.spouseWagesCents,
        socialSecurityWagesCents: base.income.socialSecurityWagesCents + input.spouseWagesCents,
      },
    });
    const mine = federal({ ...base, filingStatus: "married_separate" });
    const theirs = federal({
      ...base,
      filingStatus: "married_separate",
      childrenUnder17: 0,
      otherDependants: 0,
      income: {
        ...NO_INCOME,
        wagesCents: input.spouseWagesCents,
        socialSecurityWagesCents: input.spouseWagesCents,
      },
      studentLoanInterestCents: 0,
      mortgageInterestCents: 0,
      charityCents: 0,
      medicalCents: 0,
      otherStateLocalTaxCents: 0,
      otherAdjustmentsCents: 0,
      otherCreditsCents: 0,
    });
    return choice("filing", "Married: file jointly or separately", [
      {
        label: "Married filing jointly",
        taxCents: joint,
        eligible: true,
        why: ["Both incomes on one return, with the wider brackets and all the credits."],
      },
      {
        label: "Married filing separately (both returns)",
        taxCents: mine + theirs,
        eligible: true,
        why: [
          "Each on their own return; it loses the earned income, education and most care credits, and if one itemizes the other must too.",
        ],
      },
    ]);
  }
  const dependants = base.childrenUnder17 + base.otherDependants;
  if (dependants === 0) return null;
  const hohWhy = headOfHouseholdRules({
    married: false,
    paysOverHalfHome: input.paysOverHalfHome,
    qualifyingPerson: dependants > 0,
  });
  return choice("filing", "Head of household or single", [
    {
      label: "Head of household",
      taxCents: federal({ ...base, filingStatus: "head_of_household" }),
      eligible: hohWhy.length === 0,
      why:
        hohWhy.length > 0
          ? hohWhy
          : ["A bigger standard deduction and wider brackets than single."],
    },
    {
      label: "Single",
      taxCents: federal({ ...base, filingStatus: "single" }),
      eligible: true,
      why: ["Always open to an unmarried person."],
    },
  ]);
}

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// Choices worth bringing up in the chat: a better side, saving enough.
export const worthSaying = (c: FamilyChoice) =>
  c.better !== null && c.savesCents >= FAMILY_MIN_SAVING_CENTS;
