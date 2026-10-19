import { INTEREST_LOAN_KINDS, SELF_EMPLOYED_INCOME_CATEGORIES } from "@/config/tax-pack";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadOverrides, loadTaxForms } from "@/lib/tax-organizer";
import { buildTaxPack, packStates, type TaxPack } from "@/planning/tax-pack";
import { loadTaxProfile } from "@/lib/tax-profile";
import { loadResidency } from "@/lib/tax-states";

// Loads one person's tax-time pack for a year (spec step 72). Only their own accounts, never
// a household partner's, and only posted transactions. Spec step 119: grouped by their tax
// tags (src/lib/tax-organizer.ts), with the forms to expect.

const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function loadTaxPack(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<TaxPack> {
  const db = scopedFor(userId, client);
  const [transactions, loans, overrides, forms, profile, residency] = await Promise.all([
    db.transactions.findMany({
      where: {
        pending: false,
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
        // Money out (anything can be tagged) and contracting or gig income.
        OR: [
          { amountCents: { gt: 0 } },
          { pfcDetailed: { in: [...SELF_EMPLOYED_INCOME_CATEGORIES] } },
        ],
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
      // In a fixed order, so the pack's rows always come out the same way.
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    db.liabilities.findMany({
      where: { kind: { in: [...INTEREST_LOAN_KINDS] } },
      select: { kind: true, ytdInterestPaidCents: true, account: { select: { name: true } } },
      orderBy: [{ account: { name: "asc" } }, { id: "asc" }],
    }),
    loadOverrides(userId, { client }),
    loadTaxForms(userId, year, { client, now }),
    loadTaxProfile(userId, { client, now }),
    loadResidency(userId, year, { client }),
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
    overrides,
    forms: forms.forms,
    // Spec step 165: the states lived or worked in.
    states: packStates({
      year,
      state: profile.state.value,
      moves: residency.inUse,
      workState: residency.workState,
      locality: residency.locality,
    }),
  });
}
