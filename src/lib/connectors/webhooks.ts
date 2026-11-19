import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  WEBHOOK_EVENT_DAYS,
  WEBHOOK_MAX_BYTES,
  WEBHOOK_TOLERANCE_SECONDS,
  connectorsOn,
} from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { verifyResendSignature } from "@/lib/digest/resend-webhook";
import { systemDb } from "@/lib/system-db";
import { canonicalJson } from "./canonical-json";
import { applyLinkEvent } from "./link-events";
import { applyPartnerEvent } from "./pipeline";
import { connectorById } from "./registry";
import { isLinkEvent, type WebhookSigning } from "./types";

// Webhook intake for every connector (docs/connectors.md): one route, /api/connectors/<id>/webhook.
// Nothing is read or believed until the provider's signature checks out with its own secret; a
// signed delivery older or newer than WEBHOOK_TOLERANCE_SECONDS is refused; an event id seen before
// is acknowledged and ignored; one about an action Jane hasn't stored yet is refused with a 409 so
// the provider sends it again; and the event reaches only the person whose action it names, through
// their scoped door. Off (404) unless CONNECTORS=1. A kill switch doesn't stop it: it records what
// the partner already did, and acts on nothing.

const WHY = "A connector's webhook: nobody is signed in, and it names the action, not the person";

export type WebhookAnswer = { status: number; body: Record<string, string | boolean> };

const answer = (status: number, body: WebhookAnswer["body"]): WebhookAnswer => ({ status, body });

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// Whether this delivery was signed by the provider, with the secret in its env var.
export function signatureValid(
  signing: WebhookSigning,
  rawBody: string,
  headers: Headers,
  { env = process.env, now = new Date() }: { env?: Record<string, string | undefined>; now?: Date },
): boolean {
  const secret = env[signing.secretEnv]?.trim();
  if (!secret) return false;
  if (signing.kind === "svix") return verifyResendSignature(rawBody, headers, secret, now);
  if (signing.kind === "canonical_json_hmac") {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return false;
    }
    const at = Date.parse(String(body?.[signing.timestampField] ?? ""));
    if (!Number.isFinite(at)) return false;
    if (Math.abs(now.getTime() - at) / 1000 > WEBHOOK_TOLERANCE_SECONDS) return false;
    const signature = headers.get(signing.header) ?? "";
    if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
    const expected = createHmac("sha256", secret).update(canonicalJson(body)).digest();
    return sameBytes(Buffer.from(signature, "base64"), expected);
  }
  if (signing.kind === "signwell_event_hash") {
    let event: { type?: unknown; time?: unknown; hash?: unknown } | undefined;
    try {
      event = (JSON.parse(rawBody) as { event?: typeof event }).event;
    } catch {
      return false;
    }
    if (typeof event?.type !== "string" || typeof event.time !== "number") return false;
    if (typeof event.hash !== "string" || !/^[0-9a-f]{64}$/i.test(event.hash)) return false;
    if (Math.abs(now.getTime() / 1000 - event.time) > WEBHOOK_TOLERANCE_SECONDS) return false;
    const expected = createHmac("sha256", secret).update(`${event.type}@${event.time}`).digest();
    return sameBytes(Buffer.from(event.hash, "hex"), expected);
  }
  let timestamp: string | null;
  let signatures: string[];
  if (signing.kind === "hmac_sha256_tv") {
    // "t=1793988000,v1=ab12...,v1=cd34..."
    const parts = (headers.get(signing.header) ?? "").split(",").map((part) => part.trim());
    timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) ?? null;
    const field = `${signing.field ?? "v1"}=`;
    signatures = parts
      .filter((part) => part.startsWith(field))
      .map((part) => part.slice(field.length));
  } else {
    timestamp = headers.get(signing.timestampHeader);
    // Several while a secret rotates, comma-separated.
    signatures = (headers.get(signing.signatureHeader) ?? "").split(",").map((p) => p.trim());
  }
  if (!timestamp || !/^\d{1,15}$/.test(timestamp)) return false;
  const seconds =
    signing.kind === "hmac_sha256_tv" && signing.timestampUnit === "ms"
      ? Number(timestamp) / 1000
      : Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - seconds) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const separator = signing.kind === "hmac_sha256" ? (signing.separator ?? ".") : ".";
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}${separator}${rawBody}`)
    .digest();
  // Hex, as PostGrid's and Stripe's examples show.
  return signatures.some(
    (part) => /^[0-9a-f]{64}$/i.test(part) && sameBytes(Buffer.from(part, "hex"), expected),
  );
}

// Records the event once. False if this connector already sent this event id.
async function firstDelivery(
  connectorId: string,
  eventId: string,
  client: PrismaClient,
  now: Date,
): Promise<boolean> {
  const { count } = await systemDb(WHY, client).connectorWebhookEvent.createMany({
    data: [{ connectorId, eventId: eventId.slice(0, 200), receivedAt: now }],
    skipDuplicates: true,
  });
  await systemDb(WHY, client).connectorWebhookEvent.deleteMany({
    where: { receivedAt: { lt: new Date(now.getTime() - WEBHOOK_EVENT_DAYS * 86_400_000) } },
  });
  return count === 1;
}

const forgetDelivery = (connectorId: string, eventId: string, client: PrismaClient) =>
  systemDb(WHY, client).connectorWebhookEvent.deleteMany({
    where: { connectorId, eventId: eventId.slice(0, 200) },
  });

export async function receiveWebhook(
  connectorId: string,
  rawBody: string,
  headers: Headers,
  {
    client = defaultClient,
    now = new Date(),
    env = process.env,
  }: { client?: PrismaClient; now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<WebhookAnswer> {
  if (!connectorsOn(env)) return answer(404, { error: "Not found" });
  const connector = connectorById(connectorId);
  if (!connector?.webhook) return answer(404, { error: "Not found" });
  if (Buffer.byteLength(rawBody) > WEBHOOK_MAX_BYTES) return answer(413, { error: "Too large" });
  if (!signatureValid(connector.webhook.signing, rawBody, headers, { env, now })) {
    return answer(401, { error: "Invalid signature" });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return answer(400, { error: "Invalid JSON" });
  }
  const event = connector.webhook.parse(body);
  // Signed, but nothing we act on: acknowledged so the provider stops sending it.
  if (!event) return answer(200, { received: true, ignored: true });
  // Without an id of its own, the body's hash stands in, so an exact replay is still caught.
  const eventId = event.eventId || createHash("sha256").update(rawBody).digest("hex");
  if (!(await firstDelivery(connector.id, eventId, client, now))) {
    return answer(200, { received: true, repeat: true });
  }
  // About a link, not an action: the person whose link the partner names, by its id for it.
  if (isLinkEvent(event)) {
    const link = await systemDb(WHY, client).connectorCredential.findUnique({
      where: { connectorId_linkRef: { connectorId: connector.id, linkRef: event.linkRef } },
      select: { userId: true },
    });
    // A link not stored yet (the partner answered before Jane saved its id): sent again later.
    if (!link) {
      await forgetDelivery(connector.id, eventId, client);
      return answer(409, { error: "Not ready, send it again later" });
    }
    try {
      await applyLinkEvent(link.userId, connector.id, event.change, { client, now });
    } catch (error) {
      await forgetDelivery(connector.id, eventId, client);
      throw error;
    }
    return answer(200, { received: true });
  }
  // Whose it is: the action the partner names, found by its own id. Everything after is scoped.
  const action = await systemDb(WHY, client).connectorAction.findUnique({
    where: {
      connectorId_externalRef: { connectorId: connector.id, externalRef: event.externalRef },
    },
    select: { id: true, userId: true, status: true },
  });
  // Not ours yet: a fast partner can answer while act is still returning, before its id is stored
  // (security review on #1501). Forgotten and refused, so the provider's retry lands after it is;
  // a 200 here would lose a failed payment for good. A ref that's never ours is retried until the
  // provider gives up, which costs nothing.
  if (!action || action.status === "running") {
    await forgetDelivery(connector.id, eventId, client);
    return answer(409, { error: "Not ready, send it again later" });
  }
  try {
    await applyPartnerEvent(action.userId, action.id, event, { client, now });
  } catch (error) {
    // The 500 makes the provider send it again, and that one must not look like a repeat.
    await forgetDelivery(connector.id, eventId, client);
    throw error;
  }
  return answer(200, { received: true });
}
