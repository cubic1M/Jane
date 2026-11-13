import { createHash } from "node:crypto";
import {
  CONSENT_SCOPES,
  EXACT_TEXT_SCOPES,
  isConsentScope,
  type ConsentScope,
} from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { onSampleDataOnly } from "@/lib/concierge-mode";
import { currentRequestDetails } from "@/lib/request-details";
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
  constructor(readonly reason: "unknown" | "scopes" | "needs_text" | Unavailable) {
    super(
      reason === "unknown"
        ? "Jane doesn't know that connection."
        : reason === "scopes"
          ? "That isn't something this connection asks for."
          : reason === "needs_text"
            ? "That needs its approved wording first."
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

// The words for one scope, as the person sees them on the card and as the record keeps them: ours,
// or for a legal scope the connector's approved text with its version. Null if a legal scope has no
// approved text.
function scopeWords(connector: Pick<Connector, "consentText">, scope: ConsentScope): string | null {
  if (!EXACT_TEXT_SCOPES.includes(scope)) return CONSENT_SCOPES[scope];
  const approved = connector.consentText?.[scope];
  return approved?.text.trim() ? `${approved.text.trim()} (version ${approved.version})` : null;
}

// What the person is shown and agrees to, one line per scope (scopeWords). Null if a legal scope
// has no approved text.
export function consentWords(
  connector: Pick<Connector, "name" | "consentText">,
  scopes: readonly ConsentScope[],
): string | null {
  const lines = [`${connector.name} may:`];
  for (const scope of scopes) {
    const words = scopeWords(connector, scope);
    if (words === null) return null;
    lines.push(`- ${words}`);
  }
  return lines.join("\n");
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
  const shownText = consentWords(connector, asked as ConsentScope[]);
  // A legal scope needs its approved text: without it, there is nothing the person could agree to.
  if (shownText === null) throw new ConsentError("needs_text");
  const textVersion = createHash("sha256").update(shownText).digest("hex").slice(0, 16);
  const { ip, user_agent: userAgent } = await currentRequestDetails();
  // One current consent per connector: the new one replaces the old, which stays as history. Two
  // grants at once may both stay current; the newest is the one read (currentScopes).
  const db = scopedFor(userId, client);
  await db.connectorConsents.updateMany({
    where: { connectorId, revokedAt: null },
    data: { revokedAt: now },
  });
  await db.connectorConsents.create({
    data: {
      userId,
      connectorId,
      scopes: asked,
      grantedAt: now,
      shownText,
      textVersion,
      ip,
      userAgent,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "connector_consent_granted",
    { type: "user", id: userId },
    { connector: connectorId, scopes: asked.join(","), text_version: textVersion },
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
  // Word for word what they agreed to; null on rows from before it was kept.
  shownText: string | null;
};

// Every consent the person gave, newest first, current and revoked, for the settings page.
async function listConsents(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ConsentRow[]> {
  const rows = await scopedFor(userId, client).connectorConsents.findMany({
    orderBy: { grantedAt: "desc" },
    select: {
      id: true,
      connectorId: true,
      scopes: true,
      grantedAt: true,
      revokedAt: true,
      shownText: true,
    },
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
  // Connectors whose link the partner says stopped working (src/lib/connectors/link-events.ts).
  needsRelink: string[];
};

export async function connectionsView(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<ConnectionsView> {
  const [consents, sampleData, broken] = await Promise.all([
    listConsents(userId, { client }),
    onSampleDataOnly(userId, { client }),
    scopedFor(userId, client).connectorCredentials.findMany({
      where: { status: "needs_relink" },
      select: { connectorId: true },
    }),
  ]);
  const current = consents.filter((row) => row.revokedAt === null);
  const consented = new Set(current.map((row) => row.connectorId));
  // Each scope in the words the record will keep (scopeWords), so what's stored as shown is what
  // was shown; one whose legal text isn't approved yet can't be agreed to, so it isn't offered.
  const available = allConnectors()
    .filter(
      (c) =>
        !consented.has(c.id) &&
        whyUnavailable(c, { userId, sampleData }) === null &&
        consentWords(c, c.scopes) !== null,
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      scopes: c.scopes.map((scope) => ({ scope, label: scopeWords(c, scope) ?? "" })),
    }));
  return {
    available,
    current,
    past: consents.filter((row) => row.revokedAt !== null),
    needsRelink: broken.map((row) => row.connectorId),
  };
}
