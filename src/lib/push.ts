import webpush from "web-push";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";

// Web Push for urgent alerts and, from spec step 85, Jane's chat messages. Off unless
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are set; then a person's subscribed
// devices get them instead of email. Generate keys once with
// `npx web-push generate-vapid-keys`.

type Options = { client?: PrismaClient };

export type PushMessage = {
  title: string;
  body: string;
  url: string;
  // Jane's chat messages (spec step 85): one notification per message (a repeat replaces
  // it), with up to two of its buttons, answered through /api/chat/act.
  tag?: string;
  messageId?: string;
  actions?: { action: string; title: string }[];
};

export function pushEnabled(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}

// Safe to send to the browser: it's the public half.
export function vapidPublicKey(): string | null {
  return pushEnabled() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

export type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_KEY = 200;
const MAX_ENDPOINT = 1000;

// The browsers' own push services (Chrome, Edge's, Firefox, Safari). The server posts to whatever
// address a subscription names, so any other address would let a person make Jane call it.
const PUSH_HOST =
  /^(?:fcm\.googleapis\.com|[a-z0-9-]+\.notify\.windows\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*push\.apple\.com)$/;

// Long enough for a push service, and a server that never answers can't hold up a digest's loop.
const SEND_TIMEOUT_MS = 10_000;

// web-push reads the address again with Node's older parser, which stops a host at "%": the host
// must be spelled exactly as checked, or evil.example%2Epush.apple.com passes here and goes there.
function pushAddressAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    PUSH_HOST.test(url.hostname) &&
    endpoint.startsWith(`${url.origin}/`)
  );
}

// The subscription a browser hands over, checked before it's stored.
export function parseSubscription(value: unknown): BrowserSubscription | null {
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof v?.endpoint === "string" ? v.endpoint : "";
  const { p256dh, auth } = v?.keys ?? {};
  if (
    !pushAddressAllowed(endpoint) ||
    endpoint.length > MAX_ENDPOINT ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    p256dh.length > MAX_KEY ||
    auth.length > MAX_KEY ||
    !BASE64URL.test(p256dh) ||
    !BASE64URL.test(auth)
  ) {
    return null;
  }
  return { endpoint, keys: { p256dh, auth } };
}

export async function saveSubscription(
  userId: string,
  subscription: BrowserSubscription,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  // An endpoint belongs to one device; if it was saved for someone else, it isn't theirs now.
  await client.pushSubscription.deleteMany({
    where: { endpoint: subscription.endpoint, userId: { not: userId } },
  });
  await db.pushSubscriptions.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
}

export async function removeSubscription(
  userId: string,
  endpoint: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).pushSubscriptions.deleteMany({ where: { endpoint } });
}

type Sender = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

// Sends to every device the person subscribed. Devices the push service says are gone
// (404 or 410) are forgotten. Returns how many devices accepted it.
export async function sendPush(
  userId: string,
  message: PushMessage,
  {
    client = defaultClient,
    send = webpush.sendNotification as Sender,
  }: Options & { send?: Sender } = {},
): Promise<number> {
  if (!pushEnabled()) return 0;
  const db = scopedFor(userId, client);
  const devices = await db.pushSubscriptions.findMany({
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  const vapidDetails = {
    subject: process.env.VAPID_SUBJECT ?? "",
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  };
  let delivered = 0;
  for (const device of devices) {
    // Saved before the check above existed, or through a hole in it: never posted to, and forgotten.
    if (!pushAddressAllowed(device.endpoint)) {
      await db.pushSubscriptions.deleteMany({ where: { id: device.id } });
      continue;
    }
    try {
      await send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(message),
        { vapidDetails, TTL: 60 * 60, timeout: SEND_TIMEOUT_MS },
      );
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscriptions.deleteMany({ where: { id: device.id } });
      } else {
        log.error("Push failed", { userId, status });
      }
    }
  }
  return delivered;
}
