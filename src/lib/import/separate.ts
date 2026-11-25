import { SEPARATE_ACCOUNT } from "@/lib/account-copies";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";

// "This is a different account" (src/app/import): net worth leaves out an uploaded account that may
// be a copy of a linked one (src/planning/books.ts accountsLeftOut) until the person says it is
// another account, and Jane remembers it. Kept in jane_preferences under kind "separate", one row per
// account, so no migration; undoing deletes the row. False when the account isn't an upload of theirs.
type Db = Pick<ScopedDb, "accounts" | "janePreferences" | "userId">;

const keyOf = (accountId: string) => `${SEPARATE_ACCOUNT.keyPrefix}${accountId}`;

async function uploadOf(db: Db, accountId: string) {
  return db.accounts.findFirst({
    where: { id: accountId, source: "csv" },
    select: { id: true, name: true },
  });
}

export async function keepAccountSeparate(db: Db, accountId: string): Promise<boolean> {
  const account = await uploadOf(db, accountId);
  if (!account) return false;
  const data = { value: {}, label: `${account.name} is an account of its own` };
  await db.janePreferences.upsert({
    where: {
      userId_kind_key: { userId: db.userId, kind: SEPARATE_ACCOUNT.kind, key: keyOf(accountId) },
    },
    create: { userId: db.userId, kind: SEPARATE_ACCOUNT.kind, key: keyOf(accountId), ...data },
    update: data,
  });
  await logAudit({ type: "user", id: db.userId }, "uploaded_account_kept_separate", null, {});
  return true;
}

export async function undoKeepSeparate(db: Db, accountId: string): Promise<boolean> {
  const account = await uploadOf(db, accountId);
  if (!account) return false;
  await db.janePreferences.deleteMany({
    where: { kind: SEPARATE_ACCOUNT.kind, key: keyOf(accountId) },
  });
  await logAudit({ type: "user", id: db.userId }, "uploaded_account_separate_undone", null, {});
  return true;
}
