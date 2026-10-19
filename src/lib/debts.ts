import {
  BNPL_LOOKBACK_DAYS,
  BNPL_PROVIDERS,
  MAX_TYPED_APR_BPS,
  MAX_TYPED_DEBT_CENTS,
} from "@/config/debt";
import type { PrismaClient } from "@/generated/prisma/client";
import { bnplPlans } from "@/insights/bnpl";
import { debtBook, type DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { parseMoneyToCents } from "@/lib/money";
import { parseApr } from "@/planning/debt";

// Every debt in one place (spec step 109), loaded for one person with the same code the
// loans page, Jane's chat and Claude's tools use: loans and cards with their bank details,
// buy now, pay later plans from their payments, and the terms the person typed.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export async function loadDebts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DebtBook> {
  const db = scopedFor(userId, client);
  const asOf = isoDay(now);
  const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - BNPL_LOOKBACK_DAYS * DAY_MS);
  const words = BNPL_PROVIDERS.flatMap((p) => p.words);
  const [accounts, payments, typed] = await Promise.all([
    db.accounts.findMany({
      where: { type: { in: ["credit", "loan"] } },
      select: {
        id: true,
        name: true,
        mask: true,
        type: true,
        subtype: true,
        currentBalanceCents: true,
        liability: {
          select: {
            aprBps: true,
            rateType: true,
            minimumPaymentCents: true,
            nextPaymentDueDate: true,
            payoffDate: true,
            isOverdue: true,
            pastDueCents: true,
            description: true,
          },
        },
      },
      orderBy: { id: "asc" },
    }),
    db.transactions.findMany({
      where: {
        date: { gte: since },
        amountCents: { gt: 0 },
        OR: words.flatMap((w) => [
          { merchantName: { contains: w, mode: "insensitive" as const } },
          { description: { contains: w, mode: "insensitive" as const } },
        ]),
      },
      select: { date: true, amountCents: true, description: true, merchantName: true },
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
  ]);
  return debtBook(
    {
      accounts,
      plans: bnplPlans(
        payments.map((p) => ({ ...p, date: isoDay(p.date) })),
        asOf,
      ),
      typed: typed.map((t) => ({
        debtKey: t.debtKey,
        aprBps: t.aprBps,
        minimumPaymentCents: t.minimumPaymentCents,
        balanceCents: t.balanceCents,
        payoffDate: t.payoffDate ? isoDay(t.payoffDate) : null,
        updatedOn: isoDay(t.updatedAt),
      })),
    },
    asOf,
  );
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
  const checked = checkDebtTerms(input, isoDay(now));
  const book = await loadDebts(userId, { client, now });
  const debt = book.debts.find((d) => d.key === input.debtKey);
  if (!debt) throw new DebtTermsError("That isn't one of your debts.");
  if (debt.kind !== "bnpl" && checked.balanceCents !== null) {
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
