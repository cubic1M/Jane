import { SYNCED_KINDS, accountKindOf, syncedKindOf, type AccountKind } from "@/data-sources/types";
import type { ScopedDb } from "@/lib/db-scoped";

export type AccountSummary = {
  id: string;
  name: string;
  kind: AccountKind | null;
  kindLabel: string;
  currentBalanceCents: number | null;
  transactionCount: number;
  firstDate: string | null;
  lastDate: string | null;
};

const isoDate = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null;

export async function listAccountSummaries(db: ScopedDb): Promise<AccountSummary[]> {
  const [accounts, stats] = await Promise.all([
    db.accounts.findMany({ orderBy: { createdAt: "asc" } }),
    db.transactions.groupBy({
      by: ["accountId"],
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);
  const statsByAccount = new Map(stats.map((s) => [s.accountId, s]));

  return accounts.map((account) => {
    const kind = accountKindOf(account.type, account.subtype);
    // Loans from Plaid are labelled too ("Mortgage"), though they aren't import kinds.
    const synced = syncedKindOf(account.type, account.subtype);
    const stat = statsByAccount.get(account.id);
    return {
      id: account.id,
      name: account.name,
      kind,
      kindLabel: synced ? SYNCED_KINDS[synced].label : (account.subtype ?? account.type),
      currentBalanceCents: account.currentBalanceCents,
      transactionCount: stat?._count._all ?? 0,
      firstDate: isoDate(stat?._min.date),
      lastDate: isoDate(stat?._max.date),
    };
  });
}
