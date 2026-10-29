import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Resend's webhook, for the weekly email (src/lib/digest/send.ts). Resend signs every delivery
// the way Svix does: an HMAC-SHA256 of "<svix-id>.<svix-timestamp>.<body>", keyed by the
// endpoint's secret (RESEND_WEBHOOK_SECRET, "whsec_" then base64), base64 in svix-signature as
// "v1,<sig>" (several, space-separated, while a secret rotates).

// Deliveries signed longer ago than this are refused, so an old one can't be replayed.
export const RESEND_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function verifyResendSignature(
  body: string,
  headers: Headers,
  secret: string | undefined,
  now = new Date(),
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatures) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  if (Math.abs(now.getTime() / 1000 - sentAt) > RESEND_WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type EmailEvent = { type?: unknown; data?: { email_id?: unknown } };

// What a delivery changed: an open (the first one is kept), a spam complaint (the weekly email
// turns off, as an unsubscribe would), or nothing (another email, or an event we don't keep).
export async function recordEmailEvent(
  event: EmailEvent,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<"opened" | "complained" | "ignored"> {
  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || emailId.length === 0) return "ignored";
  // Finds the digest's owner; the writes below are scoped to them.
  const digest = await client.digest.findUnique({
    where: { resendId: emailId },
    select: { id: true, userId: true },
  });
  if (!digest) return "ignored";

  if (event.type === "email.opened") {
    const { count } = await scopedFor(digest.userId, client).digests.updateMany({
      where: { id: digest.id, emailOpenedAt: null },
      data: { emailOpenedAt: now },
    });
    if (count > 0) await track(digest.userId, "digest_opened", { digest_id: digest.id });
    return "opened";
  }
  if (event.type === "email.complained") {
    const { count } = await client.user.updateMany({
      where: { id: digest.userId, digestEnabled: true },
      data: { digestEnabled: false },
    });
    if (count > 0) {
      await logAudit(
        { type: "system", id: null },
        "digest_unsubscribed",
        { type: "user", id: digest.userId },
        { why: "spam_complaint" },
      );
      await track(digest.userId, "digest_unsubscribed", { why: "spam_complaint" });
    }
    return "complained";
  }
  return "ignored";
}
