import {
  IBR,
  POVERTY_GUIDELINE_CENTS,
  PSLF_PAYMENTS,
  RAP,
  STANDARD_MIN_PAYMENT_CENTS,
  STANDARD_YEARS,
} from "@/config/student-loans";
import { formatCents } from "@/lib/money";
import { monthlyInterest } from "./debt";
import { levelPaymentCents } from "./refinance";

// Federal student loan plans compared (spec step 114): what each would ask a month now,
// and, month by month at today's income, everything paid and anything forgiven at the end.
// The rules are in src/config/student-loans.ts with their sources. Pure; the pick is demo
// advice and only made when asked.

export type StudentPlan = "current" | "standard" | "ibr" | "rap";

export type StudentInput = {
  balanceCents: number;
  aprBps: number;
  // What they pay now and, if known, the months left on it.
  currentPaymentCents: number | null;
  agiCents: number;
  familySize: number;
  dependants: number;
  // First loans on or after July 1, 2014 (IBR's 10% and 20 years) or before.
  borrower: "new" | "old";
  // Working full time for a public service employer (PSLF after 120 qualifying payments).
  publicService: boolean;
  // Qualifying payments already counted.
  paymentsCounted: number;
};

export type PlanResult = {
  plan: StudentPlan;
  monthlyNowCents: number;
  months: number;
  totalPaidCents: number;
  forgivenCents: number;
  // Forgiven through PSLF rather than the plan's own term.
  viaPslf: boolean;
};

export type StudentComparison = {
  results: PlanResult[];
  pick: { plan: StudentPlan; why: string[] } | null;
};

export const PLAN_NAMES: Record<StudentPlan, string> = {
  current: "Your plan now",
  standard: "Standard (10 years)",
  ibr: "Income-Based Repayment (IBR)",
  rap: "Repayment Assistance Plan (RAP)",
};

export const povertyGuidelineCents = (familySize: number) =>
  POVERTY_GUIDELINE_CENTS.first + Math.max(0, familySize - 1) * POVERTY_GUIDELINE_CENTS.eachMore;

export const standardPaymentCents = (balanceCents: number, aprBps: number) =>
  Math.max(
    STANDARD_MIN_PAYMENT_CENTS,
    levelPaymentCents(balanceCents, aprBps, STANDARD_YEARS * 12),
  );

export function ibrPaymentCents(input: StudentInput): number {
  const discretionary = Math.max(
    0,
    input.agiCents - IBR.povertyMultiple * povertyGuidelineCents(input.familySize),
  );
  const payment = Math.round((IBR.share[input.borrower] * discretionary) / 12);
  return Math.min(payment, standardPaymentCents(input.balanceCents, input.aprBps));
}

export function rapShare(agiCents: number): number {
  return RAP.bands.find((b) => agiCents <= b.upToCents)!.share;
}

export function rapPaymentCents(input: StudentInput): number {
  const yearly = Math.round(rapShare(input.agiCents) * input.agiCents);
  return Math.max(
    RAP.minPaymentCents,
    Math.round(yearly / 12) - input.dependants * RAP.perDependentCents,
  );
}

// Month by month at a level payment until it's paid off or forgiven. RAP waives interest
// the payment doesn't cover and brings principal down by at least RAP.minPrincipalDropCents;
// under IBR unpaid interest builds up (it isn't added to the principal).
function simulate(
  input: StudentInput,
  plan: StudentPlan,
  payment: number,
  forgivenAfterMonths: number | null,
): PlanResult {
  let principal = input.balanceCents;
  let unpaidInterest = 0;
  let paid = 0;
  const pslfAfter =
    input.publicService && plan !== "current" && plan !== "standard"
      ? Math.max(0, PSLF_PAYMENTS - input.paymentsCounted)
      : null;
  const limit = Math.min(forgivenAfterMonths ?? 600, pslfAfter ?? 600, 600);
  for (let month = 1; month <= limit; month += 1) {
    const interest = monthlyInterest(principal, input.aprBps);
    const owed = principal + unpaidInterest + interest;
    const pay = Math.min(payment, owed);
    paid += pay;
    if (plan === "rap") {
      // Interest first; anything it doesn't cover is waived; principal drops by at least the
      // minimum, the rest matched.
      const towardPrincipal = Math.max(
        pay - interest,
        Math.min(RAP.minPrincipalDropCents, principal),
      );
      principal = Math.max(0, principal - towardPrincipal);
    } else {
      let left = pay;
      const toInterest = Math.min(left, unpaidInterest + interest);
      unpaidInterest = unpaidInterest + interest - toInterest;
      left -= toInterest;
      principal = Math.max(0, principal - left);
    }
    if (principal + unpaidInterest <= 0) {
      return {
        plan,
        monthlyNowCents: payment,
        months: month,
        totalPaidCents: paid,
        forgivenCents: 0,
        viaPslf: false,
      };
    }
  }
  const left = principal + unpaidInterest;
  return {
    plan,
    monthlyNowCents: payment,
    months: limit,
    totalPaidCents: paid,
    forgivenCents: limit < 600 ? left : 0,
    viaPslf: pslfAfter !== null && limit === pslfAfter,
  };
}

export function compareStudentPlans(
  input: StudentInput,
  { advice }: { advice: boolean },
): StudentComparison {
  const results: PlanResult[] = [];
  if (input.currentPaymentCents) {
    results.push(simulate(input, "current", input.currentPaymentCents, null));
  }
  results.push(
    simulate(
      input,
      "standard",
      standardPaymentCents(input.balanceCents, input.aprBps),
      STANDARD_YEARS * 12,
    ),
    simulate(input, "ibr", ibrPaymentCents(input), IBR.forgivenAfterYears[input.borrower] * 12),
    simulate(input, "rap", rapPaymentCents(input), RAP.forgivenAfterYears * 12),
  );
  if (!advice) return { results, pick: null };
  const options = results.filter((r) => r.plan !== "current");
  // Public service: the lowest payment, since PSLF forgives what's left after 120.
  // Otherwise: the least paid in all.
  const best = [...options].sort((a, b) =>
    input.publicService
      ? a.monthlyNowCents - b.monthlyNowCents || a.totalPaidCents - b.totalPaidCents
      : a.totalPaidCents - b.totalPaidCents || a.monthlyNowCents - b.monthlyNowCents,
  )[0];
  const now = results.find((r) => r.plan === "current");
  const why = input.publicService
    ? [
        `In public service, the lowest payment wins: ${PLAN_NAMES[best.plan]} is ${formatCents(best.monthlyNowCents)} a month now.`,
        best.viaPslf
          ? `PSLF forgives what's left after ${PSLF_PAYMENTS} qualifying payments: about ${formatCents(best.forgivenCents)}.`
          : "It pays the loan off before PSLF would forgive anything.",
      ]
    : [
        `${PLAN_NAMES[best.plan]} costs the least in all: ${formatCents(best.totalPaidCents)}${best.forgivenCents > 0 ? `, with ${formatCents(best.forgivenCents)} forgiven at the end` : ""}.`,
        now
          ? best.totalPaidCents < now.totalPaidCents
            ? `That's ${formatCents(now.totalPaidCents - best.totalPaidCents)} less than staying on your plan now.`
            : "Your plan now costs about the same, so switching isn't worth the paperwork."
          : `It's ${formatCents(best.monthlyNowCents)} a month now.`,
      ];
  if (best.plan === "ibr" || best.plan === "rap") {
    why.push("Income-driven payments are reset every year from your income and family size.");
  }
  return { results, pick: { plan: best.plan, why } };
}
