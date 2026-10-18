import webpush from "web-push";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Web Push for urgent alerts. Off unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT are set; then a person's subscribed devices get urgent alerts instead of
// email. Generate keys once with `npx web-push generate-vapid-keys`.

type Options = { client?: PrismaClient };

export type PushMessage = { title: string; body: string; url: string };

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

// The subscription a browser hands over, checked before it's stored.
export function parseSubscription(value: unknown): BrowserSubscription | null {
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof v?.endpoint === "string" ? v.endpoint : "";
  const { p256dh, auth } = v?.keys ?? {};
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
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
    try {
      await send(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(message),
        { vapidDetails, TTL: 60 * 60 },
      );
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscriptions.deleteMany({ where: { id: device.id } });
      } else {
        console.error("Push failed", { userId, status });
      }
    }
  }
  return delivered;
}
