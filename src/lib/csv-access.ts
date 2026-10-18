import type { ScopedDb } from "@/lib/db-scoped";
import type { SessionUser } from "@/lib/session";

// CSV import is for the founders and admins; everyone else links accounts through Plaid.
// "Founders" are the people who already have CSV accounts, so nobody loses access to
// data they've been importing.
export async function canImportCsv(user: SessionUser, db: Pick<ScopedDb, "accounts">) {
  if (user.role === "admin") return true;
  return (await db.accounts.count({ where: { source: "csv" } })) > 0;
}
