import type { ScopedDb } from "@/lib/db-scoped";
import type { MaybeSame } from "@/insights/net-worth";
import { accountsLeftOut, duplicateAccounts, isUpload, type LeftOut } from "@/planning/books";

// What every figure counts (src/planning/books.ts accountsLeftOut): the accounts a bank link reads
// as they are, and an uploaded statement only when it can't be a copy of one of them, nor an earlier
// upload of an account uploaded again. An account linked twice (two bank logins, or the same bank
// linked again through Link instead of reconnected) is in the database twice, with new Plaid ids for
// it and every transaction, and an account uploaded and linked is in it twice with the statement's
// old balance beside the live one. Detection counts it once (src/detection/input.ts); so must every
// page that reads accounts or transactions itself, and every one reads it here.
//
// What the person said is an account of its own: an upload with this kind and key in jane_preferences
// (the "This is a different account" tap on /import).
export const SEPARATE_ACCOUNT = { kind: "separate", keyPrefix: "account:" } as const;

type Db = Pick<ScopedDb, "accounts" | "plaidItems" | "janePreferences" | "transactions">;

async function readCounting(db: Db) {
  const [accounts, items, said] = await Promise.all([
    db.accounts.findMany({
      select: {
        id: true,
        itemId: true,
        name: true,
        mask: true,
        type: true,
        subtype: true,
        source: true,
        currentBalanceCents: true,
      },
    }),
    db.plaidItems.findMany({ select: { id: true, institutionName: true } }),
    db.janePreferences.findMany({
      where: { kind: SEPARATE_ACCOUNT.kind },
      select: { key: true },
    }),
  ]);
  // Nothing to compare: no two accounts.
  if (accounts.length < 2) return { accounts, left: new Map<string, LeftOut>() };
  const uploads = accounts.filter(isUpload).map((a) => a.id);
  const latest =
    uploads.length < 2
      ? []
      : await db.transactions.groupBy({
          by: ["accountId"],
          where: { accountId: { in: uploads } },
          _max: { date: true },
        });
  const bank = new Map(items.map((i) => [i.id, i.institutionName]));
  const left = accountsLeftOut(accounts, {
    bankOf: (a) => (a.itemId ? (bank.get(a.itemId) ?? null) : null),
    separate: new Set(said.map((p) => p.key.slice(SEPARATE_ACCOUNT.keyPrefix.length))),
    endsOn: new Map(
      latest.flatMap((t) =>
        t._max.date ? [[t.accountId, t._max.date.toISOString().slice(0, 10)]] : [],
      ),
    ),
  });
  return { accounts, left };
}

// The accounts left out of every figure, each with the account it may be and why.
export async function accountsNotCounted(db: Db): Promise<Map<string, LeftOut>> {
  return (await readCounting(db)).left;
}

// What is left out for want of proof it is another account, in the words under net worth
// (src/insights/net-worth.ts): not the certain copies, which the books check says, and only accounts
// with a balance, since one without is not counted anyway.
export async function leftOutNotes(db: Db): Promise<(MaybeSame & { id: string })[]> {
  const { accounts, left } = await readCounting(db);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return [...left].flatMap(([id, { reason, sameAs }]) => {
    const account = byId.get(id);
    return reason === "copy" || !account || account.currentBalanceCents === null
      ? []
      : [{ id, reason, left: { name: account.name }, with: { name: sameAs.name } }];
  });
}

// The ids of the accounts to leave out.
export async function accountCopies(db: Db): Promise<Set<string>> {
  return new Set((await accountsNotCounted(db)).keys());
}

// The `where` for a read of accounts that adds or reads their balances itself: only the ones counted.
export async function onlyCounted(db: Db): Promise<{ id?: { notIn: string[] } }> {
  const copies = await accountCopies(db);
  return copies.size === 0 ? {} : { id: { notIn: [...copies] } };
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
