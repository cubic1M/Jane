import type { ScopedDb } from "@/lib/db-scoped";
import { copiesToLeaveOut, duplicateAccounts } from "@/planning/books";

// An account linked twice (two bank logins, or the same bank linked again through Link instead of
// reconnected) is in the database twice, with new Plaid ids for it and every transaction. Detection
// counts it once (src/detection/input.ts); so must every page that reads accounts or transactions
// itself (beta accuracy: net worth and the Money page counted a card linked twice twice, and a card
// with Plaid Liabilities is never merged by the books check). The ids of the copies to leave out.
export async function accountCopies(db: Pick<ScopedDb, "accounts">): Promise<Set<string>> {
  const accounts = await db.accounts.findMany({
    select: { id: true, itemId: true, mask: true, type: true, subtype: true },
  });
  return copiesToLeaveOut(accounts);
}

// The rows that aren't on a copy, by the account id each names.
export const withoutCopies = <T>(
  rows: readonly T[],
  copies: ReadonlySet<string>,
  accountIdOf: (row: T) => string,
): T[] => (copies.size === 0 ? [...rows] : rows.filter((r) => !copies.has(accountIdOf(r))));

// The copies to leave out of accounts already read, and for each the id of the account kept in its
// place (a home linked to a copy is linked to the loan kept). Found in the rows given, so the
// copies always describe the balances counted from them.
export function copiesAndKeepers(
  accounts: {
    id: string;
    itemId: string | null;
    mask: string | null;
    type: string;
    subtype: string | null;
  }[],
): { copies: Set<string>; keeper: Map<string, string> } {
  const found = duplicateAccounts(accounts.map((a) => ({ ...a, name: "" })));
  return {
    copies: new Set(found.map((d) => d.duplicate.id)),
    keeper: new Map(found.map((d) => [d.duplicate.id, d.keep.id])),
  };
}
