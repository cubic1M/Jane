import type { ScopedDb } from "@/lib/db-scoped";
import { copiesToLeaveOut } from "@/planning/books";

// An account linked twice (two bank logins, or the same bank linked again through Link instead of
// reconnected) is in the database twice, with new Plaid ids for it and every transaction. Detection
// counts it once (src/detection/engine.ts); so must every page that reads accounts or transactions
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
