import type { PrismaClient } from "@/generated/prisma/client";
import { CONSENT_SCOPES, connectorsOn } from "@/config/connectors";
import { logAudit } from "@/lib/audit";
import { onSampleDataOnly } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { siteOrigin } from "@/lib/site-origin";
import { consentWords, currentScopes, grantConsent, usableConnector } from "./consent";
import { readIfReader } from "./read";
import { connectorById, whyUnavailable } from "./registry";
import type { Connector, ReadResult } from "./types";

// The one way any connector is connected (connectors batch 2, section C1): a tap inside the card that
// needs it (ConnectTap), a plain consent screen (/settings/connections/<id>: what Jane reads, from
// whom, how to stop), the partner's own step when it has one, the way back (…/return), and the data.
// No connector builds its own. Consent, the start, the way back, a no and every read are in the audit
// log. Never offered during sign-up or onboarding (src/app/onboarding-no-connectors.test.ts), and never
// again after a "Not now".

type Options = { client?: PrismaClient; now?: Date };

const DECLINED = "connector_declined:";

export type ConnectScreen = {
  connectorId: string;
  name: string;
  // What Jane reads or does, one line per scope, in the consent's own words.
  reads: string[];
  // Where the data comes from, when the connector says (Connector.from); its name says the rest.
  from: string | null;
  // Whether the partner has a step of its own after the yes.
  partnerStep: boolean;
  // Exactly what the person agrees to; null when a legal scope has no approved text yet.
  agreesTo: string | null;
};

// What the consent screen says. Throws ConsentError when the connector isn't for this person now.
export async function connectScreen(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<ConnectScreen> {
  const connector = await usableConnector(userId, connectorId, { client });
  return {
    connectorId: connector.id,
    name: connector.name,
    reads: connector.scopes.map((scope) => CONSENT_SCOPES[scope]),
    from: connector.from ?? null,
    partnerStep: Boolean(connector.connect),
    agreesTo: consentWords(connector, connector.scopes),
  };
}

export type ConnectStart =
  { next: "partner"; redirectUrl: string } | { next: "done"; read: ReadResult | null };

// The yes on the consent screen: consent to every scope it asks for, then the partner's step or the read.
export async function startConnect(
  userId: string,
  connectorId: string,
  { client = defaultClient, now = new Date(), returnUrl }: Options & { returnUrl: string },
): Promise<ConnectStart> {
  const connector = await usableConnector(userId, connectorId, { client });
  await grantConsent(userId, connector.id, connector.scopes, { client, now });
  if (connector.connect) {
    // The partner sends the person back to Jane's own address, never one from the request.
    const origin =
      siteOrigin() ??
      (URL.canParse(process.env.AUTH_URL ?? "")
        ? new URL(process.env.AUTH_URL ?? "").origin
        : null);
    if (!origin) throw new Error("A partner step needs APP_URL or AUTH_URL to come back to");
    const { redirectUrl } = await connector.connect({
      userId,
      client,
      now,
      returnUrl: `${origin}${returnUrl}`,
    });
    if (!/^https:\/\//.test(redirectUrl)) throw new Error("A partner step must be an https page");
    await logAudit(
      { type: "user", id: userId },
      "connector_connect_started",
      { type: "user", id: userId },
      { connector: connector.id, partner_step: true },
    );
    return { next: "partner", redirectUrl };
  }
  await logAudit(
    { type: "user", id: userId },
    "connector_connect_started",
    { type: "user", id: userId },
    { connector: connector.id, partner_step: false },
  );
  return { next: "done", read: await readIfReader(userId, connector.id, { client, now }) };
}

// Back from the partner's step: reads, if the person still has a current consent.
export async function finishConnect(
  userId: string,
  connectorId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReadResult | null> {
  const connector = connectorById(connectorId);
  if (!connector) return null;
  if (!(await currentScopes(userId, connector.id, { client }))?.length) return null;
  await logAudit(
    { type: "user", id: userId },
    "connector_connect_returned",
    { type: "user", id: userId },
    { connector: connector.id },
  );
  return readIfReader(userId, connector.id, { client, now });
}

// "Not now": never offered again in a card. Settings › Connections still lists it.
export async function declineConnect(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const connector = connectorById(connectorId);
  if (!connector) return;
  const key = `${DECLINED}${connector.id}`;
  await scopedFor(userId, client).janePreferences.upsert({
    where: { userId_kind_key: { userId, kind: "system", key } },
    create: { userId, kind: "system", key, label: `Don't offer ${connector.name} again` },
    update: {},
  });
  await logAudit(
    { type: "user", id: userId },
    "connector_connect_declined",
    { type: "user", id: userId },
    { connector: connector.id },
  );
}

// Whether a card offers this connector to this person now: connectors on, the connector usable for
// them, not connected already, and not turned down before.
export async function connectOffered(
  userId: string,
  connectorId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  if (!connectorsOn()) return false;
  const connector = connectorById(connectorId);
  if (!connector) return false;
  const sampleData = await onSampleDataOnly(userId, { client });
  if (whyUnavailable(connector, { userId, sampleData }) !== null) return false;
  const [scopes, declined] = await Promise.all([
    currentScopes(userId, connector.id, { client }),
    scopedFor(userId, client).janePreferences.findFirst({
      where: { kind: "system", key: `${DECLINED}${connector.id}` },
      select: { id: true },
    }),
  ]);
  return !scopes?.length && !declined;
}

// A same-site path to come back to, never another site's address.
export function safeReturnPath(raw: unknown): string {
  const path = typeof raw === "string" ? raw : "";
  return /^\/(?![/\\])[\w\-/.?=&%]*$/.test(path) && path.length <= 200 ? path : "/home";
}
