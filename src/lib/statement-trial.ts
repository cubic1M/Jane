import { randomBytes } from "node:crypto";
import { TERMS_VERSION } from "@/config/legal";
import {
  STATEMENT_TRIAL_ID_PREFIX,
  TRIAL_EMAIL_DOMAIN,
  TRIAL_HOURS,
  TRIAL_ID_PREFIX,
  TRIAL_SESSION_PREFIX,
} from "@/config/trial";
import {
  STATEMENT_TRIAL_MAX_FILE_BYTES,
  STATEMENT_TRIAL_MAX_PERSON_ROWS,
  STATEMENT_TRIAL_MAX_ROWS,
  STATEMENT_TRIAL_MAX_UPLOADS,
  STATEMENT_TRIAL_TURNED_OFF,
  statementTooBig,
  statementTooManyRows,
} from "@/config/statement-trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import type { ScopedDb } from "@/lib/db-scoped";
import { STATEMENT_TRIAL_STARTED, deleteTrialPerson } from "@/lib/trial-delete";

// Try Jane with your own statement: a brand new, empty, temporary person for each start, with no
// email, signed in with a session that ends after TRIAL_HOURS. Nothing is ever reused. Their id
// starts with STATEMENT_TRIAL_ID_PREFIX, so they count as a trial person wherever that keeps them
// out (email, analytics, metrics, the team's queue), and as a real account wherever a trial person
// would be sample data: no demo advice, no agent, no simulated company, do-it-yourself steps.

type Options = { client?: PrismaClient; now?: Date };

const HOUR_MS = 60 * 60 * 1000;

// Offered everywhere outside production; in production only with TRY_STATEMENT=1, so real
// people's statements come in only once the founder says so.
export function statementTrialEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.TRY_STATEMENT === "1";
}

export type StatementPerson = { userId: string; sessionToken: string; expires: Date };

// Whose session this browser holds, if it's still good.
export async function sessionOwner(
  sessionToken: string | undefined,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string | null> {
  if (!sessionToken) return null;
  // nosemgrep: jane-user-table-query-without-scope -- finds who a browser is from its own cookie, before there is a user to scope by: the unguessable session token is the only filter
  const session = await systemDb(
    "Whose session this browser holds, before anyone is signed in",
    client,
  ).session.findUnique({
    where: { sessionToken },
    select: { userId: true, expires: true },
  });
  return session && session.expires > now ? session.userId : null;
}

// A new, empty temporary person, with the Terms they ticked. A trial person this browser already
// has goes first, with everything they own, right away. Never anyone else: the caller refuses a
// browser signed in as a real person.
export async function startStatementPerson({
  client = defaultClient,
  now = new Date(),
  userAgent = null,
  previous = null,
}: Options & {
  userAgent?: string | null;
  previous?: string | null;
} = {}): Promise<StatementPerson> {
  if (previous?.startsWith(TRIAL_ID_PREFIX)) {
    await deleteTrialPerson(previous, "started_again", { client, now });
  }
  const id = `${STATEMENT_TRIAL_ID_PREFIX}${randomBytes(12).toString("hex")}`;
  const expires = new Date(now.getTime() + TRIAL_HOURS * HOUR_MS);
  const sessionToken = `${TRIAL_SESSION_PREFIX}${randomBytes(32).toString("hex")}`;
  const system = systemDb("Making a temporary person: nobody is signed in yet", client);
  await system.user.create({
    data: {
      id,
      email: `${id}@${TRIAL_EMAIL_DOMAIN}`,
      createdAt: now,
      // They ticked the box to get here (src/app/try/statement-actions.ts). The record of it is on
      // the audit row below, which outlives them; these show nothing else is owed.
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: now,
    },
  });
  await Promise.all([
    system.session.create({
      data: { sessionToken, userId: id, expires, userAgent: userAgent?.slice(0, 200) ?? null },
    }),
    // The sensitive-event record: a random id and the Terms' version, nothing from the statement.
    system.auditLog.create({
      data: {
        actorType: "user",
        actorId: id,
        event: STATEMENT_TRIAL_STARTED,
        targetType: "user",
        targetId: id,
        metadata: { terms_version: TERMS_VERSION },
        createdAt: now,
      },
    }),
  ]);
  return { userId: id, sessionToken, expires };
}

// A temporary try's reader stops here, before it reads a row.
export const STATEMENT_ROW_LIMIT = {
  rows: STATEMENT_TRIAL_MAX_ROWS,
  words: statementTooManyRows(),
};

// What's wrong with these files before anything reads them, or null.
export function statementFilesRefusal(bytes: number[]): string | null {
  if (!statementTrialEnabled()) return STATEMENT_TRIAL_TURNED_OFF;
  return bytes.some((b) => b > STATEMENT_TRIAL_MAX_FILE_BYTES) ? statementTooBig() : null;
}

// What's wrong with one more upload for a temporary person, or null. Rows, as the file was read.
export async function statementUploadRefusal(
  db: Pick<ScopedDb, "transactions" | "importRuns">,
  files: { rows: number }[],
): Promise<string | null> {
  const rows = files.reduce((sum, f) => sum + f.rows, 0);
  if (rows > STATEMENT_TRIAL_MAX_ROWS) return statementTooManyRows();
  const [held, uploads] = await Promise.all([
    db.transactions.count(),
    db.importRuns.count({ where: { kind: "upload" } }),
  ]);
  if (uploads >= STATEMENT_TRIAL_MAX_UPLOADS) {
    return `A temporary try holds up to ${STATEMENT_TRIAL_MAX_UPLOADS} uploads. Start over to try different statements.`;
  }
  if (held + rows > STATEMENT_TRIAL_MAX_PERSON_ROWS) {
    return `A temporary try holds up to ${STATEMENT_TRIAL_MAX_PERSON_ROWS.toLocaleString("en-US")} transactions. Start over to try different statements.`;
  }
  return null;
}
