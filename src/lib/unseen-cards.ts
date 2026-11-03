import { paymentsToUnseenCards } from "@/categorize/card-payments";
import { UNSEEN_CARD_MONTHS } from "@/config/import";
import type { ScopedDb } from "@/lib/db-scoped";
import { isoDay } from "@/lib/dates";

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// About what the person pays a month to cards with no statement on file (src/categorize/card-payments.ts):
// spending Jane can't see, said on the pages that can't count it. Null when there's none.
export async function unseenCardPaymentsMonthly(
  db: ScopedDb,
  asOf: string,
): Promise<number | null> {
  const since = new Date(`${asOf}T00:00:00Z`);
  since.setUTCMonth(since.getUTCMonth() - UNSEEN_CARD_MONTHS);
  const accounts = await db.accounts.findMany({ select: { id: true, type: true, name: true } });
  const cards = accounts.filter((a) => a.type === "credit").map((a) => a.id);
  const rows = await db.transactions.findMany({
    where: {
      pending: false,
      date: { gte: since },
      OR: [{ pfcDetailed: CARD_PAYMENT }, { accountId: { in: cards }, amountCents: { lt: 0 } }],
    },
    select: {
      id: true,
      accountId: true,
      date: true,
      amountCents: true,
      pfcDetailed: true,
      description: true,
    },
  });
  const unseen = paymentsToUnseenCards(
    rows.map((r) => ({ ...r, date: isoDay(r.date) })),
    accounts,
  );
  const total = unseen.reduce((sum, r) => sum + r.amountCents, 0);
  return total > 0 ? Math.round(total / UNSEEN_CARD_MONTHS) : null;
}
