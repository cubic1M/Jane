import { DEBT_FIRST_APR_BPS, DEBT_FIRST_MIN_CENTS } from "@/config/tax-decisions";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { loadCounting, onlyCounted, reconcileLiabilities } from "@/lib/account-copies";

// Whether paying debt down comes before a new tax-favoured contribution: the person is
// overdrawn or carries a card or loan at or above DEBT_FIRST_APR_BPS. Returns the reason in a
// sentence, or null.
export async function debtFirst(userId: string, client: PrismaClient): Promise<string | null> {
  const db = scopedFor(userId, client);
  const counting = await loadCounting(db);
  const countedWhere = await onlyCounted(counting);
  const [cash, rows] = await Promise.all([
    db.accounts.findMany({
      where: { userId, type: "depository", ...countedWhere },
      select: { currentBalanceCents: true },
    }),
    db.liabilities.findMany({
      where: { userId, kind: { in: ["credit", "loan"] } },
      select: {
        accountId: true,
        aprBps: true,
        account: { select: { currentBalanceCents: true } },
      },
    }),
  ]);
  // The rate the lender reported on either link of a loan linked twice, then the costly ones.
  const costly = reconcileLiabilities(counting, rows).filter(
    (l) => (l.aprBps ?? 0) >= DEBT_FIRST_APR_BPS,
  );
  // A card in credit has a negative balance: it owes nothing, whatever the size of the credit.
  const owed = (l: (typeof costly)[number]) => Math.max(0, l.account.currentBalanceCents ?? 0);
  const carried = costly.filter((l) => owed(l) >= DEBT_FIRST_MIN_CENTS);
  const overdrawn = cash.some((a) => (a.currentBalanceCents ?? 0) < 0);
  const cashCents = cash.reduce((n, a) => n + Math.max(0, a.currentBalanceCents ?? 0), 0);
  const owedCents = carried.reduce((n, l) => n + owed(l), 0);
  if (overdrawn)
    return "You're overdrawn" + (carried.length ? " and carrying debt at a high rate." : ".");
  // Cash that covers the costly debt means paying it off is a choice, not a pressing need.
  if (carried.length && owedCents > cashCents) {
    const top = Math.max(...carried.map((l) => l.aprBps ?? 0));
    return `You're carrying debt at up to ${(top / 100).toFixed(0)}% a year.`;
  }
  return null;
}
