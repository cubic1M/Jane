import { CONSENT_SCOPES, isConsentScope, type ConsentScope } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { onSampleDataOnly } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { allConnectors, connectorById, whyUnavailable, type Unavailable } from "./registry";
import type { Connector } from "./types";
import { deleteCredential } from "./vault";

// A person's consent to each connector: which scopes, since when, and revoked when. Nothing runs
// through a connector unless their current consent covers every scope it needs (consentCovers).
// Revoking takes effect at once: the credential is deleted with it, and the pipeline checks consent
// again just before acting. /settings/connections shows all of it.

export class ConsentError extends Error {
  constructor(readonly reason: "unknown" | "scopes" | Unavailable) {
    super(
      reason === "unknown"
        ? "Jane doesn't know that connection."
        : reason === "scopes"
          ? "That isn't something this connection asks for."
          : "That connection isn't available for you yet.",
    );
    this.name = "ConsentError";
  }
}

type Options = { client?: PrismaClient; now?: Date };

// The connector, if this person may use it now.
export async function usableConnector(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<Connector> {
  const connector = connectorById(connectorId);
  if (!connector) throw new ConsentError("unknown");
  const sampleData = await onSampleDataOnly(userId, { client });
  const why = whyUnavailable(connector, { userId, sampleData });
  if (why) throw new ConsentError(why);
  return connector;
}

export async function grantConsent(
  userId: string,
  connectorId: string,
  scopes: readonly string[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const connector = await usableConnector(userId, connectorId, { client });
  const asked = [...new Set(scopes)];
  if (
    asked.length === 0 ||
    !asked.every((scope) => isConsentScope(scope) && connector.scopes.includes(scope))
  ) {
    throw new ConsentError("scopes");
  }
  // One current consent per connector: the new one replaces the old, which stays as history. Two
  // grants at once may both stay current; the newest is the one read (currentScopes).
  const db = scopedFor(userId, client);
  await db.connectorConsents.updateMany({
    where: { connectorId, revokedAt: null },
    data: { revokedAt: now },
  });
  await db.connectorConsents.create({
    data: { userId, connectorId, scopes: asked, grantedAt: now },
  });
  await logAudit(
    { type: "user", id: userId },
    "connector_consent_granted",
    { type: "user", id: userId },
    { connector: connectorId, scopes: asked.join(",") },
  );
  await track(userId, "connector_consent_granted", {
    connector: connectorId,
    scopes: asked.length,
  });
}

// Revokes the current consent and deletes the credential. True if there was one to revoke.
export async function revokeConsent(
  userId: string,
  connectorId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const { count } = await db.connectorConsents.updateMany({
    where: { connectorId, revokedAt: null },
    data: { revokedAt: now },
  });
  await deleteCredential(userId, connectorId, { client });
  // Anything not yet run through it stops too (the pipeline checks consent again before acting).
  await db.connectorActions.updateMany({
    where: { connectorId, status: { in: ["awaiting_yes", "approved"] } },
    data: { status: "cancelled", reason: "consent_revoked", finishedAt: now },
  });
  if (count === 0) return false;
  await logAudit(
    { type: "user", id: userId },
    "connector_consent_revoked",
    { type: "user", id: userId },
    { connector: connectorId },
  );
  await track(userId, "connector_consent_revoked", { connector: connectorId });
  return true;
}

// The scopes the person's current consent gives, or null with none.
export async function currentScopes(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<ConsentScope[] | null> {
  const row = await scopedFor(userId, client).connectorConsents.findFirst({
    where: { connectorId, revokedAt: null },
    orderBy: { grantedAt: "desc" },
    select: { scopes: true },
  });
  return row ? row.scopes.filter(isConsentScope) : null;
}

// The current consent's id, kept on an action as the consent its yes was given under.
export async function currentConsentId(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<string | null> {
  const row = await scopedFor(userId, client).connectorConsents.findFirst({
    where: { connectorId, revokedAt: null },
    orderBy: { grantedAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function consentCovers(
  userId: string,
  connector: Pick<Connector, "id" | "scopes">,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const scopes = await currentScopes(userId, connector.id, { client });
  return scopes !== null && connector.scopes.every((scope) => scopes.includes(scope));
}

export type ConsentRow = {
  id: string;
  connectorId: string;
  connectorName: string;
  scopes: { scope: string; label: string }[];
  grantedAt: Date;
  revokedAt: Date | null;
};

// Every consent the person gave, newest first, current and revoked, for the settings page.
export async function listConsents(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ConsentRow[]> {
  const rows = await scopedFor(userId, client).connectorConsents.findMany({
    orderBy: { grantedAt: "desc" },
    select: { id: true, connectorId: true, scopes: true, grantedAt: true, revokedAt: true },
  });
  return rows.map((row) => ({
    ...row,
    connectorName: connectorById(row.connectorId)?.name ?? row.connectorId,
    scopes: row.scopes.map((scope) => ({
      scope,
      label: isConsentScope(scope) ? CONSENT_SCOPES[scope] : scope,
    })),
  }));
}

export type ConnectionsView = {
  // Connectors this person may use and hasn't consented to.
  available: { id: string; name: string; scopes: { scope: string; label: string }[] }[];
  current: ConsentRow[];
  past: ConsentRow[];
};

export async function connectionsView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ConnectionsView> {
  const [consents, sampleData] = await Promise.all([
    listConsents(userId, { client }),
    onSampleDataOnly(userId, { client }),
  ]);
  const current = consents.filter((row) => row.revokedAt === null);
  const consented = new Set(current.map((row) => row.connectorId));
  const available = allConnectors()
    .filter((c) => !consented.has(c.id) && whyUnavailable(c, { userId, sampleData }) === null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      scopes: c.scopes.map((scope) => ({ scope, label: CONSENT_SCOPES[scope] })),
    }));
  return { available, current, past: consents.filter((row) => row.revokedAt !== null) };
}
