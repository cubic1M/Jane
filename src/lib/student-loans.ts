import {
  IBR,
  PSLF_PAYMENTS,
  RAP,
  STUDENT_PAYMENT_LOOKBACK_DAYS,
  STUDENT_STEPS,
} from "@/config/student-loans";
import type { PrismaClient } from "@/generated/prisma/client";
import { loanPaymentCents, type Debt, type DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { todayOf } from "@/lib/today";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { parseMoneyToCents } from "@/lib/money";
import { loadProfile } from "@/lib/profile";
import {
  compareStudentPlans,
  incomeYearWithoutPaychecks,
  paycheckYearCents,
  PLAN_DEFAULTS,
  type StudentComparison,
  type StudentInput,
} from "@/planning/student-loans";
import { DAY_MS } from "@/lib/dates";

// Student loans (spec step 114), for one person: their student loan from the bank, the
// plans compared at their income, forgiveness tracking (qualifying payments counted from
// their payments to the servicer, plus any studentaid.gov counted before), and where they
// are in studentaid.gov's steps. The pick is demo advice only.

type Options = { client?: PrismaClient; now?: Date };

type StudentProfile = {
  agiCents: number | null;
  familySize: number;
  dependants: number;
  borrower: "new" | "old";
  publicService: boolean;
  countedBefore: number;
  stepsDone: number;
};

const DEFAULT_PROFILE: StudentProfile = {
  agiCents: null,
  ...PLAN_DEFAULTS,
  publicService: false,
  countedBefore: 0,
  stepsDone: 0,
};

export type StudentLoans = {
  advice: boolean;
  loan: Debt | null;
  profile: StudentProfile;
  // The income the plans use, and whether the person gave it, Jane estimated it from paychecks
  // (take-home pay, so a low estimate; the tax return's AGI is what counts), from the income it
  // sees with no paychecks (a contractor or a pension, as the student loan card reads it), or
  // Jane saw no income at all, so the $0 is unknown, not an estimate.
  agiCents: number;
  agiFrom: "you" | "paychecks" | "income" | "none";
  comparison: StudentComparison | null;
  // Forgiveness tracking: payments Jane saw (one a month) and the total counted.
  paymentsSeen: number;
  paymentsCounted: number;
  // Toward PSLF (public service) or the plan's own forgiveness.
  countingToward: { name: string; needed: number };
};

async function profileOf(userId: string, client: PrismaClient): Promise<StudentProfile> {
  const row = await scopedFor(userId, client).studentLoanProfiles.findFirst({
    select: {
      agiCents: true,
      familySize: true,
      dependants: true,
      borrower: true,
      publicService: true,
      countedBefore: true,
      stepsDone: true,
    },
  });
  if (!row) return DEFAULT_PROFILE;
  return { ...row, borrower: row.borrower === "old" ? "old" : "new" };
}

export async function loadStudentLoans(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<StudentLoans> {
  const db = scopedFor(userId, client);
  // Whole days back from the person's day (night round 11-06: a year's pay moved at 7pm).
  const today = await todayOf(userId, { client, now });
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - STUDENT_PAYMENT_LOOKBACK_DAYS * DAY_MS);
  // A year of pay back from where the statements end, not from today: counted from today, statements
  // that stopped coming lost a paycheck every two weeks and the plans moved with the calendar (debug
  // 3's calendar sweep, 11-19).
  const last = (await db.transactions.aggregate({ _max: { date: true } }))._max.date;
  const yearAgo = new Date((last?.getTime() ?? Date.parse(`${today}T00:00:00Z`)) - 365 * DAY_MS);
  const [book, advice, profile, payments, pay, seen] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    adviceMode(userId, { client }),
    profileOf(userId, client),
    db.transactions.findMany({
      where: {
        date: { gte: since },
        amountCents: { gt: 0 },
        pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
      },
      select: { date: true, amountCents: true },
    }),
    db.transactions.aggregate({
      where: {
        date: { gte: yearAgo },
        amountCents: { lt: 0 },
        pfcDetailed: { in: ["INCOME_SALARY", "INCOME_WAGES"] },
      },
      _sum: { amountCents: true },
    }),
    db.transactions.aggregate({
      where: { date: { gte: yearAgo } },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);
  const loan =
    [...book.debts]
      .filter((d) => d.kind === "student" && (d.balanceCents ?? 0) > 0 && d.aprBps !== null)
      .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0] ?? null;
  // No pay seen isn't an income of $0 (Plaid sandbox walk, 11-17: "$0.00 a year (estimated from
  // your paychecks)" with none in the accounts, and IBR at $0 a month). Someone paid as a contractor
  // or a pension has one, as the student loan card reads it (incomeYearWithoutPaychecks).
  const incomeYear =
    profile.agiCents === null && (pay._sum.amountCents ?? 0) === 0
      ? incomeYearWithoutPaychecks((await loadProfile(userId, { client, now })).facts)
      : null;
  const agiFrom =
    profile.agiCents !== null
      ? "you"
      : (pay._sum.amountCents ?? 0) !== 0
        ? "paychecks"
        : incomeYear !== null
          ? "income"
          : "none";
  // A year's pay: under a year of statements, the paychecks paced over the days they cover.
  const coveredDays =
    seen._min.date && seen._max.date
      ? Math.round((seen._max.date.getTime() - seen._min.date.getTime()) / DAY_MS) + 1
      : 365;
  const agiCents =
    profile.agiCents ?? incomeYear ?? paycheckYearCents(pay._sum.amountCents ?? 0, coveredDays);
  // One qualifying payment a month at most.
  const paymentsSeen = new Set(payments.map((p) => p.date.toISOString().slice(0, 7))).size;
  const paymentsCounted = profile.countedBefore + paymentsSeen;
  // What's been paid a month, when it's more than the bank's minimum and there's one student loan
  // to pay (debugger 11-18: "Your plan now: $25.00 a month, not paid off in 50 years" beside three
  // $231.40 MOHELA payments it had counted).
  const months = new Map<string, number>();
  for (const p of payments) {
    const month = p.date.toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + p.amountCents);
  }
  const monthly = [...months.values()].sort((a, b) => a - b);
  const paid =
    book.debts.filter((d) => d.kind === "student").length === 1 && monthly.length > 0
      ? monthly[Math.floor(monthly.length / 2)]!
      : 0;
  const reported = loan ? loanPaymentCents(loan) : null;
  const input: StudentInput | null = loan && {
    balanceCents: loan.balanceCents!,
    aprBps: loan.aprBps!,
    currentPaymentCents: Math.max(reported ?? 0, paid) || null,
    agiCents,
    familySize: profile.familySize,
    dependants: profile.dependants,
    borrower: profile.borrower,
    publicService: profile.publicService,
    paymentsCounted,
  };
  return {
    advice,
    loan,
    profile,
    agiCents,
    agiFrom,
    comparison: input ? compareStudentPlans(input, { advice }) : null,
    paymentsSeen,
    paymentsCounted,
    countingToward: profile.publicService
      ? { name: "Public Service Loan Forgiveness", needed: PSLF_PAYMENTS }
      : profile.borrower === "old"
        ? { name: "IBR forgiveness", needed: IBR.forgivenAfterYears.old * 12 }
        : { name: "IBR forgiveness", needed: IBR.forgivenAfterYears.new * 12 },
  };
}

export class StudentProfileError extends Error {}

export type StudentProfileForm = {
  agi: string;
  familySize: string;
  dependants: string;
  borrower: string;
  publicService: boolean;
  countedBefore: string;
};

const wholeNumber = (text: string, what: string, max: number) => {
  const n = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || n > max)
    throw new StudentProfileError(`Enter ${what} as a whole number.`);
  return n;
};

// Pure: the form's fields, checked. Income may be left empty (Jane estimates it).
function checkStudentProfile(form: StudentProfileForm) {
  let agiCents: number | null = null;
  if (form.agi.trim()) {
    agiCents = parseMoneyToCents(form.agi);
    if (agiCents === null || agiCents < 0) {
      throw new StudentProfileError("Enter your income in dollars, from your last tax return.");
    }
  }
  const familySize = wholeNumber(form.familySize || "1", "your family size", 20);
  if (familySize < 1) throw new StudentProfileError("Family size counts you, so it's at least 1.");
  return {
    agiCents,
    familySize,
    dependants: wholeNumber(form.dependants || "0", "dependants", 19),
    borrower: form.borrower === "old" ? "old" : "new",
    publicService: form.publicService,
    countedBefore: wholeNumber(
      form.countedBefore || "0",
      "payments counted",
      RAP.forgivenAfterYears * 12,
    ),
  };
}

export async function saveStudentProfile(
  userId: string,
  form: StudentProfileForm,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const data = checkStudentProfile(form);
  await scopedFor(userId, client).studentLoanProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await track(userId, "student_profile_saved", { public_service: data.publicService });
}

// One more of studentaid.gov's steps done; returns how many are now. `from`: the number done
// when the person saw the step, so a second tap on it, or one on a step already moved past,
// marks nothing.
export async function markStudentStep(
  userId: string,
  { client = defaultClient, from }: Options & { from?: number } = {},
): Promise<number> {
  const profile = await profileOf(userId, client);
  if (from !== undefined && profile.stepsDone !== from) {
    throw new StudentProfileError("That step is already marked done.");
  }
  const stepsDone = Math.min(STUDENT_STEPS.length, profile.stepsDone + 1);
  const db = scopedFor(userId, client);
  // The write is conditioned on the count it was worked out from.
  const { count } = await db.studentLoanProfiles.updateMany({
    where: { stepsDone: profile.stepsDone },
    data: { stepsDone },
  });
  if (count === 0) {
    if ((await db.studentLoanProfiles.count()) > 0) {
      throw new StudentProfileError("That step is already marked done.");
    }
    try {
      await db.studentLoanProfiles.create({ data: { userId, stepsDone } });
    } catch {
      throw new StudentProfileError("That step is already marked done.");
    }
  }
  await track(userId, "student_step_done", { step: STUDENT_STEPS[stepsDone - 1]?.key ?? "done" });
  return stepsDone;
}
