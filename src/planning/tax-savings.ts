import { FSA_SUGGEST_FROM_CENTS, OPEN_ENROLLMENT_BY, TAX_SAVINGS_MIN_CENTS } from "@/config/tax";
import {
  CONTRIBUTION_LIMITS,
  DEPENDENT_CARE_CREDIT,
  EDUCATION_CREDITS,
  ENERGY_CREDITS_2025,
  ITEMIZED,
  PAYROLL_TAX,
  SELF_EMPLOYMENT_TAX,
} from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { estimateTaxes, type EstimateInput, type TaxEstimate } from "./tax-estimate";

// The tax savings finder (spec step 122): every way Jane can see for the person to pay less,
// each with an estimate, why, and the one thing to do about it (a goal to start, a reminder
// to set, a page to open). Pure. Each estimate is worked out by running the estimate again
// with the change (src/planning/tax-estimate.ts, with the config rates), so it's the same
// sum as the estimate itself: federal and state income tax, plus payroll tax for pre-tax
// payroll deductions. Demo advice: shown only in demo advice mode.

export type SavingAction =
  | { kind: "task"; title: string; dueOn: string; note: string }
  | { kind: "goal"; name: string; targetCents: number; targetDate: string }
  | { kind: "link"; label: string; href: string };

export type SavingKey =
  | "retirement"
  | "ira"
  | "hsa"
  | "health_fsa"
  | "dependent_care"
  | "itemize"
  | "bunch_gifts"
  | "student_loan"
  | "education_credit"
  | "energy_credit";

export type TaxSaving = {
  key: SavingKey;
  title: string;
  why: string;
  // A year's estimated saving, in cents.
  estimateCents: number;
  action: SavingAction;
};

export type SavingsInput = {
  year: number;
  today: string;
  input: EstimateInput;
  estimate: TaxEstimate;
  pay: {
    // A workplace retirement plan: pre-tax contributions seen, or a 401(k)-type account.
    hasPlan: boolean;
    projectedRetirementCents: number;
    paychecksLeft: number;
    grossPerPaycheckCents: number;
  };
  hasHsa: boolean;
  // Out-of-pocket medical and childcare costs for the year, projected.
  medicalCents: number;
  childcareCents: number;
  // Tuition paid this year, by payee; home energy work paid last year, by payee.
  tuition: { payee: string; cents: number }[];
  energyLastYear: { payee: string; cents: number; uncapped: boolean }[];
};

const total = (e: TaxEstimate) => e.totalTaxCents + (e.state?.taxCents ?? 0);
const dollars = (cents: number) => formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "");

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// The next time a MM-DD comes round, today or later.
const nextDate = (today: string, monthDay: string) => {
  const thisYear = `${today.slice(0, 4)}-${monthDay}`;
  return thisYear >= today ? thisYear : `${Number(today.slice(0, 4)) + 1}-${monthDay}`;
};

function phaseOut(cents: number, magi: number, [from, to]: readonly [number, number]) {
  if (magi <= from) return cents;
  if (magi >= to) return 0;
  return Math.round(cents * (1 - (magi - from) / (to - from)));
}

function careShare(agiCents: number, jointly: boolean): number {
  const c = DEPENDENT_CARE_CREDIT;
  const step = jointly ? c.stepSize.marriedJoint : c.stepSize.normal;
  const firstSteps = Math.ceil(Math.max(0, agiCents - c.firstStepFrom) / 200_000);
  const share = Math.max(c.middleShare, c.topShare - firstSteps * 0.01);
  const secondFrom = jointly ? c.secondStepFrom.marriedJoint : c.secondStepFrom.normal;
  const secondSteps = Math.ceil(Math.max(0, agiCents - secondFrom) / step);
  return Math.max(c.bottomShare, share - secondSteps * 0.01);
}

export function findTaxSavings(s: SavingsInput): TaxSaving[] {
  const base = s.input;
  const before = total(s.estimate);
  const saved = (change: (i: EstimateInput) => EstimateInput) =>
    before - total(estimateTaxes(change(base)));
  // Payroll tax saved on pre-tax payroll deductions, under the Social Security wage base.
  const payroll = (cents: number) =>
    Math.round(
      cents *
        (PAYROLL_TAX.medicareRate +
          (base.income.socialSecurityWagesCents < SELF_EMPLOYMENT_TAX.wageBase
            ? PAYROLL_TAX.socialSecurityRate
            : 0)),
    );
  const lessWages = (cents: number) => (i: EstimateInput) => ({
    ...i,
    income: { ...i.income, wagesCents: i.income.wagesCents - cents },
  });
  const jointly = base.filingStatus === "married_joint";
  const out: TaxSaving[] = [];

  // Workplace retirement plan: room under the limit.
  if (s.pay.hasPlan) {
    const room = Math.max(0, CONTRIBUTION_LIMITS.workplace - s.pay.projectedRetirementCents);
    if (room > 0) {
      const thisYear = s.pay.paychecksLeft > 0;
      const extra = thisYear
        ? Math.min(room, Math.round(s.pay.paychecksLeft * s.pay.grossPerPaycheckCents * 0.5))
        : room;
      const perPaycheck = thisYear ? Math.round(extra / s.pay.paychecksLeft) : 0;
      out.push({
        key: "retirement",
        title: thisYear
          ? `Put about ${dollars(perPaycheck)} more a paycheck into your 401(k)`
          : "Raise your 401(k) contribution from January",
        why: `You're on course to put ${dollars(s.pay.projectedRetirementCents)} into your workplace plan this year, and the ${s.year} limit is ${dollars(CONTRIBUTION_LIMITS.workplace)} (more from age 50). Pre-tax contributions come off your taxable pay${thisYear ? `: ${dollars(extra)} more over your last ${s.pay.paychecksLeft} paychecks` : ""}.`,
        estimateCents: saved(lessWages(extra)),
        action: {
          kind: "task",
          title: thisYear
            ? `Raise my 401(k) contribution by ${dollars(perPaycheck)} a paycheck`
            : "Raise my 401(k) contribution for next year",
          dueOn: thisYear ? addDays(s.today, 7) : `${s.year + 1}-01-15`,
          note: "Change it on your employer's payroll or benefits site.",
        },
      });
    }
  } else {
    // No workplace plan: a traditional IRA is deductible in full (the phase-out only
    // applies to people covered by one, or whose spouse is).
    const room = CONTRIBUTION_LIMITS.ira;
    if (room > 0) {
      out.push({
        key: "ira",
        title: `Put up to ${dollars(CONTRIBUTION_LIMITS.ira)} in a traditional IRA for ${s.year}`,
        why: `With no workplace plan, a traditional IRA contribution comes off your income. You have until the April filing deadline to make one for ${s.year}.`,
        estimateCents: saved((i) => ({
          ...i,
          otherAdjustmentsCents: (i.otherAdjustmentsCents ?? 0) + room,
        })),
        action: {
          kind: "goal",
          name: `IRA for ${s.year}`,
          targetCents: CONTRIBUTION_LIMITS.ira,
          targetDate: `${s.year + 1}-04-01`,
        },
      });
    }
  }

  if (s.hasHsa) {
    const limit =
      jointly || base.childrenUnder17 > 0
        ? CONTRIBUTION_LIMITS.hsaFamily
        : CONTRIBUTION_LIMITS.hsaSelf;
    out.push({
      key: "hsa",
      title: "Use your HSA's room",
      why: `You have an HSA. Up to ${dollars(limit)} a year (${s.year}) goes in before tax, through payroll free of payroll tax too, and comes out tax-free for medical costs.`,
      estimateCents: saved(lessWages(limit)) + payroll(limit),
      action: {
        kind: "task",
        title: "Check my HSA contribution",
        dueOn: addDays(s.today, 7),
        note: "Set it on your employer's benefits site.",
      },
    });
  }

  if (s.medicalCents >= FSA_SUGGEST_FROM_CENTS) {
    const amount = Math.min(s.medicalCents, CONTRIBUTION_LIMITS.healthFsa);
    out.push({
      key: "health_fsa",
      title: `Pay about ${dollars(amount)} of medical costs from a health FSA`,
      why: `You spend about ${dollars(s.medicalCents)} a year on medical costs. Paid from a health FSA (up to ${dollars(CONTRIBUTION_LIMITS.healthFsa)}), that money skips income and payroll tax. Most employers let you sign up at open enrollment.`,
      estimateCents: saved(lessWages(amount)) + payroll(amount),
      action: {
        kind: "task",
        title: "Sign up for a health FSA at open enrollment",
        dueOn: nextDate(s.today, OPEN_ENROLLMENT_BY),
        note: `About ${dollars(amount)} for the year.`,
      },
    });
  }

  if (s.childcareCents > 0 && base.childrenUnder17 > 0) {
    const limit =
      base.filingStatus === "married_separate"
        ? CONTRIBUTION_LIMITS.dependentCareFsaMarriedSeparate
        : CONTRIBUTION_LIMITS.dependentCareFsa;
    const amount = Math.min(s.childcareCents, limit);
    const fsa = saved(lessWages(amount)) + payroll(amount);
    const costs = Math.min(
      s.childcareCents,
      DEPENDENT_CARE_CREDIT.costLimit[base.childrenUnder17 > 1 ? 1 : 0],
    );
    const credit = saved((i) => ({
      ...i,
      otherCreditsCents:
        (i.otherCreditsCents ?? 0) + Math.round(costs * careShare(s.estimate.agiCents, jointly)),
    }));
    const useFsa = fsa >= credit;
    out.push({
      key: "dependent_care",
      title: useFsa
        ? `Pay childcare through a dependent care FSA`
        : "Claim the child and dependent care credit",
      why: useFsa
        ? `You spend about ${dollars(s.childcareCents)} a year on childcare. Up to ${dollars(limit)} of it from a dependent care FSA skips income and payroll tax: more than the credit would give (about ${dollars(credit)}).`
        : `You spend about ${dollars(s.childcareCents)} a year on childcare. The credit is worth more to you than a dependent care FSA (about ${dollars(fsa)}).`,
      estimateCents: Math.max(fsa, credit),
      action: useFsa
        ? {
            kind: "task",
            title: "Sign up for a dependent care FSA at open enrollment",
            dueOn: nextDate(s.today, OPEN_ENROLLMENT_BY),
            note: `About ${dollars(amount)} for the year.`,
          }
        : { kind: "link", label: "See your childcare tags", href: "/taxes/tags" },
    });
  }

  const d = s.estimate.deduction;
  if (d.kind === "itemized") {
    const margin = d.itemizedCents - d.standardCents;
    out.push({
      key: "itemize",
      title: "Itemize: it's worth more than the standard deduction",
      why: `Your mortgage interest, state taxes and gifts come to about ${dollars(d.itemizedCents)}, more than the ${dollars(d.standardCents)} standard deduction. Keep the receipts; your tax tags and forms have them.`,
      estimateCents: Math.round(margin * s.estimate.marginalRate),
      action: { kind: "link", label: "See tax tags", href: "/taxes/tags" },
    });
  } else if (base.charityCents > 0 && d.itemizedCents + base.charityCents > d.standardCents) {
    const gifts = base.charityCents;
    const thisYear = saved((i) => ({ ...i, charityCents: i.charityCents + gifts }));
    // Next year, with no gifts, the non-itemizer deduction for them is gone.
    const nonItemizer = jointly
      ? ITEMIZED.nonItemizerCharity.marriedJoint
      : ITEMIZED.nonItemizerCharity.normal;
    const nextYearLoss = Math.round(Math.min(gifts, nonItemizer) * s.estimate.marginalRate);
    out.push({
      key: "bunch_gifts",
      title: "Give next year's donations this December",
      why: `Two years of gifts in one (about ${dollars(gifts * 2)}) would take your itemized deductions past the ${dollars(d.standardCents)} standard deduction this year; next year you'd take the standard deduction as usual.`,
      estimateCents: thisYear - nextYearLoss,
      action: {
        kind: "task",
        title: "Give next year's donations before Dec 31",
        dueOn: `${s.year}-12-15`,
        note: `About ${dollars(gifts)}, to the charities you already give to.`,
      },
    });
  }

  if (s.estimate.adjustments.studentLoanInterestCents > 0) {
    out.push({
      key: "student_loan",
      title: "Your student loan interest lowers your tax",
      why: `About ${dollars(s.estimate.adjustments.studentLoanInterestCents)} of student loan interest comes off your income. Your servicer's 1098-E shows the exact amount.`,
      // What taking it away would cost.
      estimateCents: -saved((i) => ({ ...i, studentLoanInterestCents: 0 })),
      action: { kind: "link", label: "See tax forms", href: "/taxes#forms" },
    });
  }

  const tuition = s.tuition.reduce((sum, t) => sum + t.cents, 0);
  if (tuition > 0) {
    const range = jointly
      ? EDUCATION_CREDITS.phaseOut.married_joint
      : EDUCATION_CREDITS.phaseOut.single;
    const credit = phaseOut(
      Math.round(Math.min(tuition, EDUCATION_CREDITS.llcCostLimit) * EDUCATION_CREDITS.llcRate),
      s.estimate.agiCents,
      range as [number, number],
    );
    const payee = s.tuition[0].payee;
    out.push({
      key: "education_credit",
      title: "Claim an education credit for tuition",
      why: `You paid about ${dollars(tuition)} to ${payee} this year. The Lifetime Learning Credit is 20% of up to ${dollars(EDUCATION_CREDITS.llcCostLimit)}; for a student in their first four years of college, the American Opportunity Credit can be more.`,
      estimateCents: saved((i) => ({
        ...i,
        otherCreditsCents: (i.otherCreditsCents ?? 0) + credit,
      })),
      action: {
        kind: "task",
        title: `Get the 1098-T from ${payee}`,
        dueOn: `${s.year + 1}-01-31`,
        note: "Schools send it by the end of January.",
      },
    });
  }

  for (const job of s.energyLastYear) {
    const credit = Math.round(
      job.uncapped
        ? job.cents * ENERGY_CREDITS_2025.rate
        : Math.min(job.cents * ENERGY_CREDITS_2025.rate, ENERGY_CREDITS_2025.improvementCap),
    );
    out.push({
      key: "energy_credit",
      title: `Claim the ${s.year - 1} energy credit for ${job.payee}`,
      why: `You paid ${job.payee} about ${dollars(job.cents)} in ${s.year - 1}. Home energy work finished in ${s.year - 1} can still get 30% back on that year's return (Form 5695), amended if it's already filed. These credits ended for work after 2025.`,
      estimateCents: credit,
      action: {
        kind: "task",
        title: `Ask about the ${s.year - 1} energy credit for ${job.payee}`,
        dueOn: addDays(s.today, 14),
        note: "Form 5695; an amended return if the year's already filed.",
      },
    });
  }

  return out
    .filter((x) => x.estimateCents >= TAX_SAVINGS_MIN_CENTS)
    .sort((a, b) => b.estimateCents - a.estimateCents || a.key.localeCompare(b.key));
}
