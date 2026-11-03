import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { forgetReads, READ_OPERATIONS } from "@/lib/read-memo";
import { asSystem, asSystemTransaction, SCOPED_QUERY_TRANSACTION, withSystemRole } from "@/lib/rls";

// The door to the whole room (docs/security/rls.md). A person's data goes through scopedFor; only
// code that truly works across people, or before there is a person, comes here: cron, webhooks,
// admin, retention, sign-in, the system's own records. Every use says why, in words: a lint rule
// (src/security/lint/no-raw-db.mjs) refuses anything but a sentence, so a reviewer can read them
// all with `grep -rn "systemDb(\|systemTransaction(" src`.
//
// Each query is its own short transaction that first switches to the jane_system role, sent in one
// network flight with the query where it can be (src/lib/rls-pg.ts). The login role itself may use
// no table (jane_app), so a query that went through neither door fails.

type TransactionOnly = "$transaction" | "$extends" | "$on" | "$connect" | "$disconnect";

// A client for one line's worth of work. Its own type: passing one where a raw client is expected
// doesn't compile, as scopedFor would then switch role inside a switched query. Several statements
// that must land together go through systemTransaction.
export type SystemDb = Omit<PrismaClient, TransactionOnly> & { readonly __system: true };
export type SystemTx = Prisma.TransactionClient & { readonly __system: true };

function extended(client: PrismaClient): SystemDb {
  return client.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        const reads = READ_OPERATIONS.has(operation);
        const send = () =>
          withSystemRole((switched) =>
            switched
              ? client
                  .$transaction(
                    [
                      asSystem(client, reads ? "reads" : "writes"),
                      query(args) as unknown as Prisma.PrismaPromise<unknown>,
                    ],
                    SCOPED_QUERY_TRANSACTION,
                  )
                  .then(([, result]) => result)
              : (query(args) as Promise<unknown>),
          );
        if (reads) return send();
        // A write changes what the page's scoped reads would see (src/lib/read-memo.ts).
        forgetReads();
        try {
          return await send();
        } finally {
          forgetReads();
        }
      },
    },
  }) as unknown as SystemDb;
}

const clients = new WeakMap<object, SystemDb>();

export function systemDb(why: string, client: PrismaClient = db): SystemDb {
  if (!why.trim()) throw new Error("systemDb needs a reason");
  let system = clients.get(client);
  if (!system) {
    system = extended(client);
    clients.set(client, system);
  }
  return system;
}

// Several statements as one transaction, all as the system.
export function systemTransaction<T>(
  why: string,
  run: (tx: SystemTx) => Promise<T>,
  client: PrismaClient = db,
  options: { maxWait?: number; timeout?: number } = SCOPED_QUERY_TRANSACTION,
): Promise<T> {
  if (!why.trim()) throw new Error("systemTransaction needs a reason");
  return asSystemTransaction(
    client as unknown as Parameters<typeof asSystemTransaction<Prisma.TransactionClient, T>>[0],
    (tx) => run(tx as SystemTx),
    options,
  ).finally(() => forgetReads());
}
