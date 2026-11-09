import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The vault: each person's credential for each connector (an OAuth token set, a partner's account
// key), encrypted with AES-256-GCM (src/lib/crypto.ts) and rotated with the other secrets
// (src/lib/key-rotation.ts). Like the Plaid and Robinhood tokens, a credential is never logged or
// returned: it opens only for the length of a callback, and nothing here hands back the value.

export class NoCredential extends Error {
  constructor(readonly connectorId: string) {
    // Names the connector only: never the value, never the person.
    super(`No usable credential for ${connectorId}`);
    this.name = "NoCredential";
  }
}

type Options = { client?: PrismaClient; now?: Date };

const whereOf = (userId: string, connectorId: string) => ({
  userId_connectorId: { userId, connectorId },
});

export async function storeCredential(
  userId: string,
  connectorId: string,
  secret: string,
  {
    client = defaultClient,
    expiresAt = null,
    linkRef = null,
  }: Options & { expiresAt?: Date | null; linkRef?: string | null } = {},
): Promise<void> {
  if (!secret) throw new Error("A credential can't be empty");
  const secretEncrypted = encrypt(secret);
  // A fresh credential is a working link.
  await scopedFor(userId, client).connectorCredentials.upsert({
    where: whereOf(userId, connectorId),
    create: { userId, connectorId, secretEncrypted, expiresAt, linkRef },
    update: { secretEncrypted, expiresAt, linkRef, status: "active" },
  });
  await logAudit(
    { type: "user", id: userId },
    "connector_credential_stored",
    { type: "user", id: userId },
    { connector: connectorId, expires: expiresAt !== null },
  );
}

export async function hasCredential(
  userId: string,
  connectorId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).connectorCredentials.findUnique({
    where: whereOf(userId, connectorId),
    select: { expiresAt: true },
  });
  return Boolean(row && (!row.expiresAt || row.expiresAt > now));
}

// Opens the credential for `withSecret` only. An expired or missing one is NoCredential, so a
// connector asks the person to connect again rather than acting on something stale.
export async function withCredential<T>(
  userId: string,
  connectorId: string,
  withSecret: (secret: string) => Promise<T>,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<T> {
  const row = await scopedFor(userId, client).connectorCredentials.findUnique({
    where: whereOf(userId, connectorId),
    select: { secretEncrypted: true, expiresAt: true },
  });
  if (!row || (row.expiresAt && row.expiresAt <= now)) throw new NoCredential(connectorId);
  let secret: string;
  try {
    secret = decrypt(row.secretEncrypted);
  } catch {
    // A key that's gone or a value that was tampered with: no detail, and nothing to act on.
    throw new NoCredential(connectorId);
  }
  return withSecret(secret);
}

export async function deleteCredential(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).connectorCredentials.deleteMany({
    where: { connectorId },
  });
  if (count > 0) {
    await logAudit(
      { type: "user", id: userId },
      "connector_credential_deleted",
      { type: "user", id: userId },
      { connector: connectorId },
    );
  }
  return count > 0;
}
