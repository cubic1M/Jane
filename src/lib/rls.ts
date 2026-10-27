import type { Prisma } from "@/generated/prisma/client";

// Row-level security, the database's own check under scopedFor (docs/security/rls.md). A scoped
// query runs in a transaction that first switches to the jane_rls role with the person's id in
// app.user_id; the policies on every user-owned table (prisma/migrations/*_row_level_security)
// then return and change only that person's rows, whatever the query asks for.
//
// Both settings are transaction-local (set_config's third argument), so a pooled connection
// (Neon's pgbouncer, which hands out a connection per transaction) never carries them into the
// next transaction, someone else's or a cron job's.

export const RLS_ROLE = "jane_rls";

export const AS_USER_SQL =
  "SELECT set_config('role', 'jane_rls', true), set_config('app.user_id', $1, true)";

// The same, marked with what the transaction does, for the app's pool, which sends it together
// with the statement after it, in one round trip (src/lib/rls-pg.ts).
export const AS_USER_READ_SQL = `${AS_USER_SQL} /* reads */`;
export const AS_USER_WRITE_SQL = `${AS_USER_SQL} /* writes */`;
const AS_USER_SQLS = new Set([AS_USER_SQL, AS_USER_READ_SQL, AS_USER_WRITE_SQL]);

// A scoped query is its own short transaction, and waits for a connection and runs
// as long as it did before it had one: Prisma's transaction defaults (2s to get a connection,
// 5s to finish) failed busy pages under load. The function's own time limit still applies.
export const SCOPED_QUERY_TRANSACTION = { maxWait: 60_000, timeout: 60_000 };

type RawClient = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Prisma.PrismaPromise<number>;
};

// The statement that makes the rest of the transaction run as `userId`. `one`: the transaction
// is this and one Prisma query, which reads or writes.
export function asUser(
  client: RawClient,
  userId: string,
  one?: "reads" | "writes",
): Prisma.PrismaPromise<number> {
  if (!userId) throw new Error("A user-scoped query needs a user id");
  const sql =
    one === "reads" ? AS_USER_READ_SQL : one === "writes" ? AS_USER_WRITE_SQL : AS_USER_SQL;
  return client.$executeRawUnsafe(sql, userId);
}

// Whether a raw query is that statement (the read cache doesn't count it as a write).
export function isAsUser(operation: string, args: unknown): boolean {
  return operation === "$executeRawUnsafe" && Array.isArray(args) && AS_USER_SQLS.has(args[0]);
}

// A database that couldn't make the role (the migration warns instead of failing) or won't let
// the app switch to it. Then scoped queries run as they did before row-level security, filtered
// by scopedFor alone, and it is reported once; with RLS_REQUIRED=1 they fail instead.
// Kept on globalThis: a production build can bundle this module more than once, and the
// answer is the database's, the same for every copy.
type Status = "unknown" | "on" | "off";
const state = ((globalThis as { janeRls?: { status: Status } }).janeRls ??= { status: "unknown" });

const ROLE_ERROR = new RegExp(`role "${RLS_ROLE}"`);

const messageOf = (error: unknown) => String((error as { message?: unknown })?.message ?? error);

// Runs `attempt` with row-level security on, or off when the database can't do it. Falls back
// only when switching role failed (`atSetup`), so the work itself never runs twice.
export async function withRls<T>(
  attempt: (rls: boolean) => Promise<T>,
  atSetup: () => boolean = () => true,
): Promise<T> {
  if (state.status === "off") return attempt(false);
  try {
    const result = await attempt(true);
    state.status = "on";
    return result;
  } catch (error) {
    const missingRole = atSetup() && ROLE_ERROR.test(messageOf(error));
    if (!missingRole || process.env.RLS_REQUIRED === "1") throw error;
    // Queries already under way when it was found out each land here: report it once.
    // (rlsStatus(), not state.status: another query may have changed it while this one ran.)
    if (rlsStatus() !== "off") void reportOff(error);
    state.status = "off";
    return attempt(false);
  }
}

// Once per process, in the logs and on /admin/errors.
async function reportOff(error: unknown) {
  const reason = messageOf(error).slice(0, 200);
  console.error("Row-level security is off: scoped queries are filtered by the app only", {
    reason,
  });
  try {
    const [{ recordError }, { db }] = await Promise.all([
      import("@/lib/error-log"),
      import("@/lib/db"),
    ]);
    await recordError(new Error(`Row-level security is off: ${reason}`), { routeType: "rls" }, db);
  } catch {
    // Reporting never fails the query.
  }
}

// Whether scoped queries in this process run under row-level security ("unknown" before the first).
export const rlsStatus = () => state.status;

// One interactive transaction as `userId`: every statement in `run`, raw SQL included, sees
// only that person's rows. `client` may be extended (the scoped client's own transactions).
export function asUserTransaction<Tx extends RawClient, T>(
  client: { $transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> },
  userId: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  let setupFailed = false;
  return withRls(
    (rls) =>
      client.$transaction(async (tx) => {
        if (rls)
          await asUser(tx, userId).catch((error: unknown) => {
            setupFailed = true;
            throw error;
          });
        return run(tx);
      }),
    () => setupFailed,
  );
}

// For tests: start again as if nothing had run.
export function resetRlsForTests() {
  state.status = "unknown";
}
