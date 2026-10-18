import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

// Every query on a user-owned table goes through here. scopeArgs ANDs the user's id onto
// every filter, so a caller's own filter can only narrow it: asking for another user's
// rows matches nothing. Writes always get the user's id. Ids passed in relations
// (e.g. accountId) must come from scoped reads.

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

function whereUser(where: unknown, userId: string): Args {
  const scoped: Args = { ...(where as Args | undefined) };
  const and = scoped.AND === undefined ? [] : Array.isArray(scoped.AND) ? scoped.AND : [scoped.AND];
  scoped.AND = [...and, { userId }];
  return scoped;
}

export function scopeArgs(operation: string, args: Args | undefined, userId: string): Args {
  const scoped: Args = { ...args };

  if (FILTER_OPERATIONS.has(operation)) {
    scoped.where = whereUser(scoped.where, userId);
  } else if (UPDATE_OPERATIONS.has(operation)) {
    scoped.where = whereUser(scoped.where, userId);
    // Setting userId again stops an update from moving a row to another user.
    scoped.data = withUser(scoped.data, userId);
  } else if (operation === "create") {
    scoped.data = withUser(scoped.data, userId);
  } else if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(scoped.data) ? scoped.data : [scoped.data];
    scoped.data = rows.map((row) => withUser(row, userId));
  } else if (operation === "upsert") {
    scoped.where = whereUser(scoped.where, userId);
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
    // An interactive transaction over the same scoped tables.
    transaction: <T>(
      run: (tx: {
        findings: typeof scoped.finding;
        decisions: typeof scoped.decision;
        actions: typeof scoped.action;
      }) => Promise<T>,
    ) =>
      scoped.$transaction((tx) =>
        run({ findings: tx.finding, decisions: tx.decision, actions: tx.action }),
      ),
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
    merchantCategories: scoped.merchantCategory,
    subscriptionChecks: scoped.subscriptionCheck,
  };
}

export type ScopedDb = ReturnType<typeof scopedFor>;

// The usual entry point in pages, server actions and route handlers.
export async function scopedDb(): Promise<ScopedDb> {
  const user = await requireUser();
  return scopedFor(user.id);
}
