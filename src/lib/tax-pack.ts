import {
  CHARITY_CATEGORIES,
  INTEREST_LOAN_KINDS,
  PREPARER_GROUPS,
  SELF_EMPLOYED_INCOME_CATEGORIES,
} from "@/config/tax-pack";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { buildTaxPack, type TaxPack } from "@/planning/tax-pack";

// Loads one person's tax-time pack for a year (spec step 72). Only their own accounts, never
// a household partner's, and only posted transactions.

const PACK_CATEGORIES = [
  ...CHARITY_CATEGORIES,
  ...Object.values(PREPARER_GROUPS).flat(),
  ...SELF_EMPLOYED_INCOME_CATEGORIES,
];

const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function loadTaxPack(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<TaxPack> {
  const db = scopedFor(userId, client);
  const [transactions, loans] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        pfcDetailed: { in: PACK_CATEGORIES },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
    }),
    db.liabilities.findMany({
      where: { kind: { in: [...INTEREST_LOAN_KINDS] } },
      select: { kind: true, ytdInterestPaidCents: true, account: { select: { name: true } } },
    }),
  ]);
  return buildTaxPack({
    year,
    today: iso(now),
    transactions: transactions.map((t) => ({ ...t, date: iso(t.date) })),
    loans: loans.map((l) => ({
      name: l.account.name,
      kind: l.kind,
      ytdInterestPaidCents: l.ytdInterestPaidCents,
    })),
  });
}
