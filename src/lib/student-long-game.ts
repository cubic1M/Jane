import { LONG_GAME, PSLF_PAYMENTS, STUDENT_PAYMENT_LOOKBACK_DAYS } from "@/config/student-loans";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DeadlineError, addDeadline } from "@/lib/deadlines";
import { formatCents } from "@/lib/money";
import { loadRefinance } from "@/lib/refinance";
import { loadStudentLoans, type StudentLoans } from "@/lib/student-loans";
import {
  nextOnCycle,
  pslfCount,
  taxPlanDue,
  refiGuide,
  taxOnForgiven,
  type PslfCount,
  type RefiGuide,
  type TaxOnForgiven,
} from "@/planning/student-long-game";
import { DAY_MS, isoDay } from "@/lib/dates";

// Student loans, the long game (spec step 225), on top of the plans (src/lib/student-loans.ts):
// PSLF counted month by month with the employer certification date, the income-driven
// recertification date, both as deadlines; the forgiveness date and the tax on what's
// forgiven (a deadline hands it to the person's tax planning); and whether refinancing makes
// sense. A federal loan is never suggested for refinancing without saying what's lost.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook };

export class StudentDatesError extends Error {}

export type LongGame = {
  available: boolean;
  loan: StudentLoans["loan"];
  advice: boolean;
  loanType: "federal" | "private";
  publicService: boolean;
  pslf: PslfCount | null;
  // The next date to certify the employer (public service only) and to recertify income.
  certifyOn: string | null;
  recertifyOn: string | null;
  // When what's left is forgiven by the plan the person is on now, and the tax on it.
  forgiveness: { plan: string; on: string; forgivenCents: number; viaPslf: boolean } | null;
  tax: TaxOnForgiven | null;
  refi: RefiGuide | null;
  assumptions: string[];
};

const none: LongGame = {
  available: false,
  loan: null,
  advice: false,
  loanType: "federal",
  publicService: false,
  pslf: null,
  certifyOn: null,
  recertifyOn: null,
  forgiveness: null,
  tax: null,
  refi: null,
  assumptions: [],
};

export async function loadStudentLongGame(
  userId: string,
  { client = defaultClient, now = new Date(), book }: Options = {},
): Promise<LongGame> {
  const asOf = isoDay(now);
  const loans = await loadStudentLoans(userId, { client, now, book });
  if (!loans.loan) return { ...none, advice: loans.advice };
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - STUDENT_PAYMENT_LOOKBACK_DAYS * DAY_MS);
  const [extra, payments, refi] = await Promise.all([
    db.studentLoanProfiles.findFirst({
      select: { loanType: true, lastCertifiedOn: true, recertifyOn: true },
    }),
    db.transactions.findMany({
      where: {
        date: { gte: since },
        amountCents: { gt: 0 },
        pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
      },
      select: { date: true },
    }),
    loans.advice ? loadRefinance(userId, { client, now, book }) : null,
  ]);
  const loanType = extra?.loanType === "private" ? "private" : "federal";
  const seenMonths = [...new Set(payments.map((p) => isoDay(p.date).slice(0, 7)))];
  const pslf = loans.profile.publicService
    ? pslfCount({ countedBefore: loans.profile.countedBefore, seenMonths, asOf })
    : null;
  const certifyOn =
    loans.profile.publicService && extra?.lastCertifiedOn
      ? nextOnCycle(isoDay(extra.lastCertifiedOn), LONG_GAME.certifyEveryMonths, asOf)
      : null;
  const recertifyOn = extra?.recertifyOn
    ? nextOnCycle(isoDay(extra.recertifyOn), LONG_GAME.recertifyEveryMonths, asOf)
    : null;

  // The plan the person is on now: when its forgiveness comes. A recertification date means
  // they're on an income-driven plan, so its forgiveness counts even when today's payment
  // would clear the loan.
  const results = loans.comparison?.results ?? [];
  const now_ = results.find((r) => r.plan === "current") ?? null;
  const idr = recertifyOn
    ? ([...results]
        .filter((r) => r.plan === "ibr" || r.plan === "rap")
        .sort((a, b) => a.monthlyNowCents - b.monthlyNowCents)[0] ?? null)
    : null;
  const current = now_ && now_.forgivenCents > 0 ? now_ : idr && idr.forgivenCents > 0 ? idr : now_;
  const forgiveness =
    current && current.forgivenCents > 0
      ? {
          plan: current.plan,
          on: pslf && current.viaPslf ? (pslf.forgivenOn ?? asOf) : addMonths(asOf, current.months),
          forgivenCents: current.forgivenCents,
          viaPslf: current.viaPslf,
        }
      : null;
  const comparison = refi?.comparisons.find((c) => c.product === "student");
  const offer = comparison?.pick ?? comparison?.offers[0] ?? null;
  return {
    available: true,
    loan: loans.loan,
    advice: loans.advice,
    loanType,
    publicService: loans.profile.publicService,
    pslf,
    certifyOn,
    recertifyOn,
    forgiveness,
    tax: forgiveness ? taxOnForgiven(forgiveness.forgivenCents, forgiveness.viaPslf) : null,
    refi: loans.advice
      ? refiGuide({
          loanType,
          publicService: loans.profile.publicService,
          currentAprBps: loans.loan.aprBps ?? 0,
          offer: offer
            ? {
                lender: offer.offer.lender,
                aprBps: offer.offer.aprBps,
                savingCents: offer.savingCents,
              }
            : null,
        })
      : null,
    assumptions: [
      loans.profile.publicService
        ? `${PSLF_PAYMENTS} qualifying payments in public service: ${loans.profile.countedBefore} counted before Jane started, plus one for each month a payment was seen.`
        : "Not in public service, so no Public Service Loan Forgiveness is counted.",
      `Forgiveness dates assume you keep paying on time each month on the plan you're on.`,
    ],
  };
}

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

export type DatesForm = { loanType: string; lastCertifiedOn: string; recertifyOn: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The dates the person gives: federal or private, when the employer was last certified, and
// the day the income-driven plan must be recertified. Then the deadlines are brought up to date.
export async function saveStudentDates(
  userId: string,
  form: DatesForm,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const check = (v: string, what: string) => {
    if (!v.trim()) return null;
    if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
      throw new StudentDatesError(`Pick the date ${what}.`);
    }
    return new Date(`${v}T00:00:00Z`);
  };
  const data = {
    loanType: form.loanType === "private" ? "private" : "federal",
    lastCertifiedOn: check(form.lastCertifiedOn, "your employer was last certified"),
    recertifyOn: check(form.recertifyOn, "your income-driven plan is due to be recertified"),
    // A new date means a new deadline.
    certifyDeadlineId: null,
    recertifyDeadlineId: null,
  };
  await scopedFor(userId, client).studentLoanProfiles.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  await track(userId, "student_dates_saved", { loan_type: data.loanType });
  await syncStudentDeadlines(userId, { client, now });
}

// Puts the next certification, recertification and forgiven-debt-tax dates on the deadlines
// list, once each; a date that has moved on gets a new one.
export async function syncStudentDeadlines(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const game = await loadStudentLongGame(userId, { client, now });
  if (!game.available) return 0;
  const db = scopedFor(userId, client);
  const row = await db.studentLoanProfiles.findFirst({
    select: { certifyDeadlineId: true, recertifyDeadlineId: true, taxDeadlineId: true },
  });
  if (!row) return 0;
  let added = 0;
  const put = async (
    field: "certifyDeadlineId" | "recertifyDeadlineId" | "taxDeadlineId",
    title: string,
    dueOn: string | null,
    note: string,
  ) => {
    if (!dueOn || row[field]) return;
    try {
      await addDeadline(userId, { title, dueOn, kind: "other", note }, { client, now });
    } catch (error) {
      // A date the deadlines list won't take (too far ahead) waits for a later run.
      if (error instanceof DeadlineError) return;
      throw error;
    }
    const deadline = await db.deadlines.findFirst({
      where: { title, dueOn: new Date(`${dueOn}T00:00:00Z`) },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    await db.studentLoanProfiles.updateMany({ where: {}, data: { [field]: deadline?.id ?? null } });
    added += 1;
  };
  await put(
    "certifyDeadlineId",
    "Certify your employer for Public Service Loan Forgiveness",
    game.certifyOn,
    "Use the PSLF Help Tool at studentaid.gov/pslf. Certify every year and whenever you change employer.",
  );
  await put(
    "recertifyDeadlineId",
    "Recertify your income-driven student loan plan",
    game.recertifyOn,
    "Your payment resets from your income and family size. Missing it can raise your payment.",
  );
  if (
    game.forgiveness &&
    game.tax &&
    taxPlanDue(game.forgiveness.on, game.tax.taxable, isoDay(now))
  ) {
    await put(
      "taxDeadlineId",
      `Plan for tax on forgiven student debt in ${game.forgiveness.on.slice(0, 4)}`,
      game.forgiveness.on,
      `About ${formatCents(game.tax.forgivenCents)} forgiven; the tax could be about ${formatCents(game.tax.estimateCents)} (an estimate). It goes to your tax plan.`,
    );
  }
  return added;
}
