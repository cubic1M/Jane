import {
  IBR,
  POVERTY_GUIDELINE_CENTS,
  PSLF_PAYMENTS,
  RAP,
  STANDARD_MIN_PAYMENT_CENTS,
  STANDARD_YEARS,
  STUDENT_INCOME_MIN_DAYS,
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

type PlanResult = {
  plan: StudentPlan;
  monthlyNowCents: number;
  months: number;
  totalPaidCents: number;
  forgivenCents: number;
  // Forgiven through PSLF rather than the plan's own term.
  viaPslf: boolean;
  // Still owed when the payments run out at LONGEST_MONTHS, neither paid off nor forgiven: a
  // payment at or below the interest (Plaid sandbox's $25 minimum on a $14,688 loan, debugger
  // 11-16, read "$15,000.00 in all").
  leftCents: number;
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

// The longest the month-by-month run goes.
const LONGEST_MONTHS = 600;

// "In all" for a plan: everything paid, or that it never gets there.
export const inAll = (r: Pick<PlanResult, "totalPaidCents" | "leftCents">) =>
  r.leftCents > 0 ? `Not paid off in ${LONGEST_MONTHS / 12} years` : formatCents(r.totalPaidCents);

export const povertyGuidelineCents = (familySize: number) =>
  POVERTY_GUIDELINE_CENTS.first + Math.max(0, familySize - 1) * POVERTY_GUIDELINE_CENTS.eachMore;

// What the plans assume until the person says otherwise: one person, no dependants, first loans
// on or after July 1, 2014.
export const PLAN_DEFAULTS = { familySize: 1, dependants: 0, borrower: "new" } as const;

// A year's pay from the last year's paychecks, paced over the days the statements cover when that's
// under a year (debugger 11-06: six months of a teacher's pay read as a year's): the income the
// plans use when the person hasn't given one.
export const paycheckYearCents = (payCents: number, coveredDays: number) =>
  Math.round(
    (Math.abs(payCents) * 365) / Math.min(365, Math.max(STUDENT_INCOME_MIN_DAYS, coveredDays)),
  );

// With no paychecks, a year of the income Jane sees, when it knows how they're paid without them:
// as a contractor or gig worker, or a pension. Anything else left in the accounts (interest, a
// refund, money from family) isn't an income to size a plan on (Plaid sandbox walk, 11-17). The
// student loan card and /loans/student both read it, so the card says what the page it opens says
// (debug 3, rule 83, 11-20: a contractor's card at $70,416.72 a year, the page at $0).
const PAID_WITHOUT_PAYCHECKS: readonly unknown[] = ["uneven", "pension"];
export function incomeYearWithoutPaychecks(
  facts: Readonly<Record<string, { value: unknown } | undefined>>,
): number | null {
  const monthly = facts.monthly_income?.value;
  if (!PAID_WITHOUT_PAYCHECKS.includes(facts.income_pattern?.value)) return null;
  return typeof monthly === "number" && monthly > 0 ? monthly * 12 : null;
}

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

// The least an income-driven plan (IBR or RAP) would ask a month now, by the same rules and
// defaults as the plans compared on /loans/student. Without the loan's rate IBR's cap can't be
// worked out, so RAP alone.
export function lowestIncomeDrivenCents(
  balanceCents: number,
  aprBps: number | null,
  agiCents: number,
): number {
  const input: StudentInput = {
    ...PLAN_DEFAULTS,
    balanceCents,
    aprBps: aprBps ?? 0,
    currentPaymentCents: null,
    agiCents,
    publicService: false,
    paymentsCounted: 0,
  };
  const rap = rapPaymentCents(input);
  return aprBps === null ? rap : Math.min(rap, ibrPaymentCents(input));
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
  const limit = Math.min(
    forgivenAfterMonths ?? LONGEST_MONTHS,
    pslfAfter ?? LONGEST_MONTHS,
    LONGEST_MONTHS,
  );
  for (let month = 1; month <= limit; month += 1) {
    const interest = monthlyInterest(principal, input.aprBps);
    const owed = principal + unpaidInterest + interest;
    const pay = Math.min(payment, owed);
    paid += pay;
    if (plan === "rap") {
      // Interest first; anything it doesn't cover is waived; principal drops by at least the
      // minimum, the rest matched.
      // The matched drop can't be more than what was paid: a $10 payment drops $10, not $50.
      const towardPrincipal = Math.max(
        pay - interest,
        Math.min(RAP.minPrincipalDropCents, principal, pay),
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
        leftCents: 0,
      };
    }
  }
  const left = principal + unpaidInterest;
  return {
    plan,
    monthlyNowCents: payment,
    months: limit,
    totalPaidCents: paid,
    forgivenCents: limit < LONGEST_MONTHS ? left : 0,
    viaPslf: pslfAfter !== null && limit === pslfAfter,
    leftCents: limit < LONGEST_MONTHS ? 0 : left,
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
          ? now.leftCents > 0
            ? `Your plan now's ${formatCents(now.monthlyNowCents)} a month doesn't pay the loan off in ${LONGEST_MONTHS / 12} years.`
            : best.totalPaidCents < now.totalPaidCents
              ? `That's ${formatCents(now.totalPaidCents - best.totalPaidCents)} less than staying on your plan now.`
              : "Your plan now costs about the same, so switching isn't worth the paperwork."
          : `It's ${formatCents(best.monthlyNowCents)} a month now.`,
      ];
  if (best.plan === "ibr" || best.plan === "rap") {
    why.push("Income-driven payments are reset every year from your income and family size.");
  }
  return { results, pick: { plan: best.plan, why } };
}
