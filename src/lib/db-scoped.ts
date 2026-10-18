import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

// Every query on a user-owned table goes through here. scopeArgs adds the user's id to
// each filter and each write, after the caller's own arguments, so a caller can't widen
// or override it. Ids passed in relations (e.g. accountId) must come from scoped reads.

type Args = Record<string, unknown>;

const FILTER_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "delete",
  "deleteMany",
]);

const UPDATE_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);

function withUser(value: unknown, userId: string): Args {
  return { ...(value as Args | undefined), userId };
}

export function scopeArgs(operation: string, args: Args | undefined, userId: string): Args {
  const scoped: Args = { ...args };

  if (FILTER_OPERATIONS.has(operation)) {
    scoped.where = withUser(scoped.where, userId);
  } else if (UPDATE_OPERATIONS.has(operation)) {
    scoped.where = withUser(scoped.where, userId);
    // Setting userId again stops an update from moving a row to another user.
    scoped.data = withUser(scoped.data, userId);
  } else if (operation === "create") {
    scoped.data = withUser(scoped.data, userId);
  } else if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(scoped.data) ? scoped.data : [scoped.data];
    scoped.data = rows.map((row) => withUser(row, userId));
  } else if (operation === "upsert") {
    scoped.where = withUser(scoped.where, userId);
    scoped.create = withUser(scoped.create, userId);
    scoped.update = withUser(scoped.update, userId);
  } else {
    // Fail closed: a new Prisma operation must be reviewed before it is allowed here.
    throw new Error(`"${operation}" is not supported on user-scoped queries`);
  }

  return scoped;
}

export function scopedFor(userId: string, client: PrismaClient = db) {
  const scoped = client.$extends({
    query: {
      $allModels: {
        $allOperations({ operation, args, query }) {
          return query(scopeArgs(operation, args as Args, userId) as typeof args);
        },
      },
    },
  });

  // Only user-owned tables are exposed; users, audit_log and analytics have their own helpers.
  return {
    userId,
    plaidItems: scoped.plaidItem,
    accounts: scoped.account,
    transactions: scoped.transaction,
    recurringStreams: scoped.recurringStream,
    findings: scoped.finding,
    decisions: scoped.decision,
    actions: scoped.action,
    digests: scoped.digest,
    membershipIntents: scoped.membershipIntent,
  };
}

export type ScopedDb = ReturnType<typeof scopedFor>;

// The usual entry point in pages, server actions and route handlers.
export async function scopedDb(): Promise<ScopedDb> {
  const user = await requireUser();
  return scopedFor(user.id);
}
