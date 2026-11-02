import { createHmac, timingSafeEqual } from "node:crypto";

// Companies' replies through Resend's inbound email, for when real mail is turned on. NEVER RUN
// against Resend: built from its docs (resend.com/docs/dashboard/receiving, read 2026-11-02) and
// tested against a mock. Its webhook carries no body and signs with Svix, so it can't use the Bearer
// route (../../app/api/agent/inbound/route.ts): verify the signature, fetch the email, then the reply
// goes through handleReply like any other. Still to test live: `reply+token@` addresses.

// How far a webhook's timestamp may be from now. Svix leaves it to the receiver.
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

const equal = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

// docs.svix.com/receiving/verifying-payloads/how-manual: HMAC-SHA256 of "{id}.{timestamp}.{body}",
// keyed with the base64 after "whsec_"; the header lists "v1,<base64>" entries, any may match.
export function verifySvix(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now: Date,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(now.getTime() - seconds * 1000) > WEBHOOK_TOLERANCE_MS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return signature.split(" ").some((entry) => equal(entry.split(",")[1] ?? "", expected));
}

export type ReceivedEmail = { from: string; to: string[]; subject: string; text: string };

const RESEND_API = "https://api.resend.com";

const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// GET /emails/receiving/{id}: the webhook only says one arrived.
export async function fetchReceivedEmail(
  emailId: string,
  { apiKey, fetcher = fetch }: { apiKey: string; fetcher?: typeof fetch },
): Promise<ReceivedEmail> {
  const response = await fetcher(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status} for a received email`);
  const body = (await response.json()) as {
    from?: unknown;
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    html?: unknown;
  };
  const text = typeof body.text === "string" ? body.text : "";
  return {
    from: typeof body.from === "string" ? body.from : "",
    to: Array.isArray(body.to) ? body.to.filter((t): t is string => typeof t === "string") : [],
    subject: typeof body.subject === "string" ? body.subject : "",
    text: text || (typeof body.html === "string" ? stripHtml(body.html) : ""),
  };
}
