import { accountCopies, withoutCopies } from "@/lib/account-copies";
import {
  BNPL_LOOKBACK_DAYS,
  BNPL_PROVIDERS,
  MAX_TYPED_APR_BPS,
  MAX_TYPED_DEBT_CENTS,
} from "@/config/debt";
import type { PrismaClient } from "@/generated/prisma/client";
import { bnplPlans } from "@/insights/bnpl";
import { debtBook, type DebtBook } from "@/insights/debts";
import { PAID_LOAN_CATEGORIES, paidLoans } from "@/insights/paid-loans";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { parseMoneyToCents } from "@/lib/money";
import { parseApr } from "@/planning/debt";
import { DAY_MS, isoDay } from "@/lib/dates";
import { localDate, timezoneOf, todayOf } from "@/lib/today";
import { cachedCopy } from "@/lib/read-cache";

// Every debt in one place (spec step 109), loaded for one person with the same code the
// loans page, Jane's chat and Claude's tools use: loans and cards with their bank details,
// buy now, pay later plans from their payments, and the terms the person typed.

type Options = { client?: PrismaClient; now?: Date };

export async function loadDebts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DebtBook> {
  // Read once per sync (src/lib/read-cache.ts): every debt feature asks.
  return cachedCopy(`debts:${userId}:${now.toISOString()}`, client, () =>
    loadDebtsFrom(userId, { client, now }),
  );
}

async function loadDebtsFrom(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DebtBook> {
  const db = scopedFor(userId, client);
  // The person's own day (src/lib/today.ts): at 7pm in Los Angeles UTC's is tomorrow, and the
  // Loans tree's "in the next month" lost a payment due today (gate C's calendar sweep, 11-15).
  const [asOf, timezone] = await Promise.all([
    todayOf(userId, { client, now }),
    timezoneOf(userId, { client }),
  ]);
  const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - BNPL_LOOKBACK_DAYS * DAY_MS);
  const words = BNPL_PROVIDERS.flatMap((p) => p.words);
  const [listedAccounts, payments, typed, newLoans, transfers, loanPayments, copies, cardPayments] =
    await Promise.all([
      db.accounts.findMany({
        where: { type: { in: ["credit", "loan"] } },
        select: {
          id: true,
          name: true,
          mask: true,
          type: true,
          subtype: true,
          currentBalanceCents: true,
          source: true,
          liability: {
            select: {
              aprBps: true,
              rateType: true,
              minimumPaymentCents: true,
              nextPaymentDueDate: true,
              payoffDate: true,
              isOverdue: true,
              pastDueCents: true,
              originationPrincipalCents: true,
              description: true,
            },
          },
        },
        orderBy: { id: "asc" },
      }),
      db.transactions.findMany({
        where: {
          date: { gte: since },
          pending: false,
          amountCents: { gt: 0 },
          OR: words.flatMap((w) => [
            { merchantName: { contains: w, mode: "insensitive" as const } },
            { description: { contains: w, mode: "insensitive" as const } },
          ]),
        },
        select: {
          accountId: true,
          date: true,
          amountCents: true,
          description: true,
          merchantName: true,
        },
      }),
      db.debtTerms.findMany({
        select: {
          debtKey: true,
          aprBps: true,
          minimumPaymentCents: true,
          balanceCents: true,
          payoffDate: true,
          updatedAt: true,
        },
      }),
      // Spec step 112: loans the person accepted through Jane, once funded.
      db.loanApplications.findMany({
        where: { status: { in: ["funded", "paid_off"] }, fundedAt: { not: null } },
        select: {
          id: true,
          lender: true,
          product: true,
          aprBps: true,
          rateType: true,
          termMonths: true,
          amountCents: true,
          monthlyCents: true,
          fundedAt: true,
          status: true,
        },
      }),
      // Spec step 113: balances moved to a 0% card, until that card is linked.
      db.balanceTransfers.findMany({
        where: { status: "active" },
        select: {
          id: true,
          issuer: true,
          cardName: true,
          amountCents: true,
          feeCents: true,
          promoMonths: true,
          monthlyNeededCents: true,
          startedOn: true,
          promoEndsOn: true,
        },
      }),
      // Loans paid from checking with no loan account on file (src/insights/paid-loans.ts).
      db.transactions.findMany({
        where: {
          date: { gte: since },
          pending: false,
          amountCents: { gt: 0 },
          pfcDetailed: { in: Object.keys(PAID_LOAN_CATEGORIES) },
        },
        select: {
          accountId: true,
          date: true,
          amountCents: true,
          description: true,
          merchantName: true,
          pfcDetailed: true,
        },
      }),
      accountCopies(db),
      // A card paid from checking: with no card on file, it's a card Jane can't see yet.
      db.transactions.count({
        where: {
          date: { gte: since },
          pending: false,
          amountCents: { gt: 0 },
          pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          account: { type: "depository" },
        },
      }),
    ]);
  // An account linked twice counts once (src/lib/account-copies.ts).
  const accounts = withoutCopies(listedAccounts, copies, (a) => a.id);
  const cardPaidNotOnFile = cardPayments > 0 && !accounts.some((a) => a.type === "credit");
  const book = debtBook(
    {
      accounts,
      plans: bnplPlans(
        withoutCopies(payments, copies, (p) => p.accountId).map(({ accountId: _, ...p }) => ({
          ...p,
          date: isoDay(p.date),
        })),
        asOf,
      ),
      typed: typed.map((t) => ({
        debtKey: t.debtKey,
        aprBps: t.aprBps,
        minimumPaymentCents: t.minimumPaymentCents,
        balanceCents: t.balanceCents,
        payoffDate: t.payoffDate ? isoDay(t.payoffDate) : null,
        // Their day too: typed at 10pm in Los Angeles isn't "typed on" UTC's tomorrow (debugger 11-16).
        updatedOn: localDate(t.updatedAt, timezone),
      })),
      paid: paidLoans(
        withoutCopies(loanPayments, copies, (p) => p.accountId).map(({ accountId: _, ...p }) => ({
          ...p,
          date: isoDay(p.date),
        })),
        asOf,
      ),
      newLoans: [
        ...newLoans.map(({ id, fundedAt, status, ...l }) => ({
          ...l,
          applicationId: id,
          fundedOn: isoDay(fundedAt!),
          // Paid off early: nothing owed and nothing due, whatever the schedule said.
          paidOff: status === "paid_off",
        })),
        ...transfers.map((t) => ({
          applicationId: t.id,
          lender: t.issuer,
          product: "personal",
          aprBps: 0,
          rateType: "intro",
          termMonths: t.promoMonths,
          amountCents: t.amountCents + t.feeCents,
          monthlyCents: t.monthlyNeededCents,
          fundedOn: isoDay(t.startedOn),
          transfer: { cardName: t.cardName, promoEndsOn: isoDay(t.promoEndsOn) },
        })),
      ],
    },
    asOf,
  );
  return { ...book, cardPaidNotOnFile };
}

// The debt book already loaded for this person (Jane's snapshot loads it once and hands it
// to every debt loader), or loaded now.
export function debtsOr(
  book: DebtBook | undefined,
  userId: string,
  options: Options = {},
): Promise<DebtBook> {
  return book ? Promise.resolve(book) : loadDebts(userId, options);
}

export class DebtTermsError extends Error {}

export type DebtTermsInput = {
  debtKey: string;
  apr: string;
  minimum: string;
  balance: string;
  payoffDate: string;
};

type CheckedTerms = {
  aprBps: number | null;
  minimumPaymentCents: number | null;
  balanceCents: number | null;
  payoffDate: Date | null;
};

const blank = (s: string) => s.trim() === "";

// Pure: the form's fields, checked. Every field may be left empty, but not all of them.
export function checkDebtTerms(input: DebtTermsInput, today: string): CheckedTerms {
  const money = (text: string, what: string) => {
    if (blank(text)) return null;
    const cents = parseMoneyToCents(text);
    if (cents === null || cents < 0 || cents > MAX_TYPED_DEBT_CENTS) {
      throw new DebtTermsError(`Enter the ${what} in dollars.`);
    }
    return cents;
  };
  let aprBps: number | null = null;
  if (!blank(input.apr)) {
    aprBps = parseApr(input.apr);
    if (aprBps === null || aprBps > MAX_TYPED_APR_BPS) {
      throw new DebtTermsError("Enter the rate as a yearly percentage, like 15.99.");
    }
  }
  let payoffDate: Date | null = null;
  const day = input.payoffDate.trim();
  if (day) {
    payoffDate = new Date(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isoDay(payoffDate) !== day) {
      throw new DebtTermsError("Pick the payoff date.");
    }
    if (day < today) throw new DebtTermsError("The payoff date can't be in the past.");
  }
  const checked = {
    aprBps,
    minimumPaymentCents: money(input.minimum, "monthly payment"),
    balanceCents: money(input.balance, "amount left to pay"),
    payoffDate,
  };
  if (Object.values(checked).every((v) => v === null)) {
    throw new DebtTermsError("Fill in at least one of the terms.");
  }
  return checked;
}

// Saves what the person typed for one of their own debts. Loans and cards take a rate,
// payment and payoff date; a balance only for buy now, pay later plans, since an
// account's balance always comes from the bank.
export async function saveDebtTerms(
  userId: string,
  input: DebtTermsInput,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  // Their day: in the evening, UTC's date refused a payoff date of today as in the past.
  const checked = checkDebtTerms(input, await todayOf(userId, { client, now }));
  const book = await loadDebts(userId, { client, now });
  const debt = book.debts.find((d) => d.key === input.debtKey);
  if (!debt) throw new DebtTermsError("That isn't one of your debts.");
  // A plan's or a loan seen in payments: no bank reports what's owed, so the person types it.
  if (debt.kind !== "bnpl" && !debt.key.startsWith("paid:") && checked.balanceCents !== null) {
    throw new DebtTermsError("The balance comes from your bank.");
  }
  await scopedFor(userId, client).debtTerms.upsert({
    where: { userId_debtKey: { userId, debtKey: debt.key } },
    create: { userId, debtKey: debt.key, ...checked, updatedAt: now },
    update: { ...checked, updatedAt: now },
  });
  await track(userId, "debt_terms_saved", { kind: debt.kind });
}

export async function clearDebtTerms(
  userId: string,
  debtKey: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).debtTerms.deleteMany({ where: { debtKey } });
  await track(userId, "debt_terms_cleared");
}
