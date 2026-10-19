import {
  IBR,
  PSLF_PAYMENTS,
  RAP,
  STUDENT_PAYMENT_LOOKBACK_DAYS,
  STUDENT_STEPS,
} from "@/config/student-loans";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Debt, DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { parseMoneyToCents } from "@/lib/money";
import {
  compareStudentPlans,
  type StudentComparison,
  type StudentInput,
} from "@/planning/student-loans";

// Student loans (spec step 114), for one person: their student loan from the bank, the
// plans compared at their income, forgiveness tracking (qualifying payments counted from
// their payments to the servicer, plus any studentaid.gov counted before), and where they
// are in studentaid.gov's steps. The pick is demo advice only.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

export type StudentProfile = {
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
  familySize: 1,
  dependants: 0,
  borrower: "new",
  publicService: false,
  countedBefore: 0,
  stepsDone: 0,
};

export type StudentLoans = {
  advice: boolean;
  loan: Debt | null;
  profile: StudentProfile;
  // The income the plans use, and whether the person gave it or Jane estimated it from
  // paychecks (take-home pay, so a low estimate; the tax return's AGI is what counts).
  agiCents: number;
  agiFrom: "you" | "paychecks";
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
  const since = new Date(now.getTime() - STUDENT_PAYMENT_LOOKBACK_DAYS * DAY_MS);
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS);
  const [book, advice, profile, payments, pay] = await Promise.all([
    debtsOr(given, userId, { client, now }),
    adviceMode(userId, { client }),
    profileOf(userId, client),
    db.transactions.findMany({
      where: {
        date: { gte: since },
        amountCents: { gt: 0 },
        pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
      },
      select: { date: true },
    }),
    db.transactions.aggregate({
      where: {
        date: { gte: yearAgo },
        amountCents: { lt: 0 },
        pfcDetailed: { in: ["INCOME_SALARY", "INCOME_WAGES"] },
      },
      _sum: { amountCents: true },
    }),
  ]);
  const loan =
    [...book.debts]
      .filter((d) => d.kind === "student" && (d.balanceCents ?? 0) > 0 && d.aprBps !== null)
      .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0] ?? null;
  const agiFrom = profile.agiCents !== null ? "you" : "paychecks";
  const agiCents = profile.agiCents ?? Math.abs(pay._sum.amountCents ?? 0);
  // One qualifying payment a month at most.
  const paymentsSeen = new Set(payments.map((p) => p.date.toISOString().slice(0, 7))).size;
  const paymentsCounted = profile.countedBefore + paymentsSeen;
  const input: StudentInput | null = loan && {
    balanceCents: loan.balanceCents!,
    aprBps: loan.aprBps!,
    currentPaymentCents: loan.paymentCents,
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
export function checkStudentProfile(form: StudentProfileForm) {
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

// One more of studentaid.gov's steps done; returns how many are now.
export async function markStudentStep(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<number> {
  const profile = await profileOf(userId, client);
  const stepsDone = Math.min(STUDENT_STEPS.length, profile.stepsDone + 1);
  await scopedFor(userId, client).studentLoanProfiles.upsert({
    where: { userId },
    create: { userId, stepsDone },
    update: { stepsDone },
  });
  await track(userId, "student_step_done", { step: STUDENT_STEPS[stepsDone - 1]?.key ?? "done" });
  return stepsDone;
}
