import { robinhoodOffered } from "@/config/robinhood";
import type { PrismaClient } from "@/generated/prisma/client";
import { onlyDemoBank } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit, type AuditActor } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { forgetSince, removeOrphans } from "@/lib/evidence/orphans";
import { forgetPrimer } from "@/lib/jane-agent/primer-cache";
import { isTrialUser } from "@/lib/trial-ids";
import { revokeTokens, type Tokens } from "./oauth";
import { newAccountKey, openSecrets, sealSecrets } from "./secrets";

// A person's Robinhood connection: who may have one, saving it, what they're shown about it, and
// removing it with everything read through it.

export const CONNECTION_STATUS = { active: "active", reconnect: "reconnect" } as const;

type Options = { client?: PrismaClient };

export type RefusedReason = "trial" | "demo";

// Trial people are sample data and never reach a company, and sample accounts beside a real
// brokerage would blur which numbers are real. Someone with nothing linked yet is welcome.
export async function whyCantConnect(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<RefusedReason | null> {
  if (isTrialUser(userId)) return "trial";
  if (await onlyDemoBank(userId, client)) return "demo";
  return null;
}

// Saves a new sign-in, encrypted. Reconnecting keeps the account key, so their accounts carry on.
export async function saveConnection(
  userId: string,
  tokens: Tokens,
  clientId: string,
  { client = defaultClient }: Options = {},
): Promise<{ id: string; reconnected: boolean }> {
  const db = scopedFor(userId, client);
  const existing = await db.robinhoodConnections.findFirst({
    select: { secretsEncrypted: true },
  });
  const secretsEncrypted = sealSecrets({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountKey: existing ? openSecrets(existing.secretsEncrypted).accountKey : newAccountKey(),
  });
  const fields = {
    secretsEncrypted,
    clientId,
    accessExpiresAt: tokens.expiresAt,
    status: CONNECTION_STATUS.active,
    lastErrorCode: null,
    lastErrorAt: null,
    failures: 0,
    nextTryAt: null,
    syncingSince: null,
  };
  const saved = await db.robinhoodConnections.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
    select: { id: true },
  });
  return { id: saved.id, reconnected: existing !== null };
}

export type ConnectionView = {
  status: "active" | "reconnect";
  lastUpdated: Date | null;
  // A read that didn't work, and hasn't since.
  failing: boolean;
  // Their own other copies of Robinhood (an upload, a typed balance, a bank link), which count too.
  twins: string[];
};

// What the page shows. Never the tokens: they aren't even read.
export async function connectionView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ConnectionView | null> {
  const db = scopedFor(userId, client);
  const [row, twins] = await Promise.all([
    db.robinhoodConnections.findFirst({
      select: { status: true, lastSyncedAt: true, lastErrorCode: true },
    }),
    db.accounts.findMany({
      where: {
        type: "investment",
        source: { not: "robinhood" },
        OR: [
          { name: { contains: "robinhood", mode: "insensitive" } },
          { item: { institutionName: { contains: "robinhood", mode: "insensitive" } } },
        ],
      },
      select: { name: true },
    }),
  ]);
  if (!row) return null;
  return {
    status: row.status === CONNECTION_STATUS.reconnect ? "reconnect" : "active",
    lastUpdated: row.lastSyncedAt,
    failing: row.lastErrorCode !== null,
    twins: twins.map((t) => t.name),
  };
}

export type RemovalReason = "user_disconnected" | "user_deleted_data" | "inactive";

// Deletes the tokens and everything read through it: its accounts, with their holdings, trades and
// balance history (ON DELETE CASCADE), and what was worked out from them. Only then does it end the
// connection at Robinhood, if Robinhood offers a way: a slow server, or running out of time waiting
// on one, can't leave the tokens here. False when there was nothing to remove. With the switch off
// nothing reaches Robinhood, and account deletion still removes everything here.
export async function removeConnection(
  userId: string,
  reason: RemovalReason,
  {
    client = defaultClient,
    actor = { type: "user", id: userId },
  }: Options & { actor?: AuditActor } = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const row = await db.robinhoodConnections.findFirst({
    select: { id: true, secretsEncrypted: true, clientId: true, createdAt: true },
  });
  if (!row) return false;
  let tokens: string[] = [];
  try {
    const { accessToken, refreshToken } = openSecrets(row.secretsEncrypted);
    tokens = [refreshToken, accessToken].filter((t): t is string => Boolean(t));
  } catch {
    // A value that can't be opened can't be sent: it's still deleted below.
  }
  await db.robinhoodConnections.deleteMany({ where: { id: row.id } });
  forgetPrimer(userId);
  await removeOrphans(userId, { client });
  await forgetSince(db, row.createdAt, "bank");
  const revoked = robinhoodOffered() && (await revokeTokens(row.clientId, tokens));
  await logAudit(
    actor,
    "robinhood_disconnected",
    { type: "robinhood_connection", id: row.id },
    { user_id: userId, reason, ended_at_robinhood: revoked },
  );
  await track(userId, "robinhood_disconnected", { reason });
  return true;
}
