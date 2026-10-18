import { randomBytes, timingSafeEqual } from "node:crypto";
import { SENDBLUE_API_BASE, SENDBLUE_TIMEOUT_MS, TEXT_ERROR_LENGTH } from "@/config/messaging";

// How Jane's texts leave (spec step 78). Apple has no public iMessage API, so texts go
// through Sendblue, which sends an iMessage and falls back to SMS when the phone can't
// take one. With all four SENDBLUE_* variables set, texts really go out. Without them,
// outside production, a simulated provider stands in: each text is kept in text_messages
// and printed in the dev log, and /settings/texts lets you answer as the phone would, so
// the whole loop runs in development and tests. In production without keys, texts are off
// and nothing pretends to send.
//
// Sendblue details, from docs.sendblue.com (checked Oct 18, 2026):
// - Verified: POST https://api.sendblue.com/api/send-message with headers sb-api-key-id
//   and sb-api-secret-key and a JSON body { number, from_number, content } (E.164
//   numbers; from_number is the Sendblue line). Statuses: REGISTERED, PENDING, DECLINED,
//   QUEUED, ACCEPTED, SENT, DELIVERED, ERROR.
// - Verified: inbound texts arrive as the "receive" webhook (registered on the dashboard
//   under Developer → Webhooks, or POST /api/account/webhooks) with fields including
//   content, is_outbound, message_handle, number (the person's number, to reply to),
//   from_number, group_id and opted_out. With a secret set on the webhook, every request
//   carries it in the sb-signing-secret header; it's a shared secret, not a signature.
// - Verified: delivery is at least once (dedupe on message_handle); a 2xx stops retries.
// - Not verified (the docs show no example): the send call's response body. We read
//   message_handle and status from it, as on the message object in /api/v2/messages, and
//   treat a missing handle as a failure.
// - Not verified: whether the "outbound" status webhook carries sb-signing-secret like
//   "receive" does. We register it with the same secret and refuse it otherwise, and we
//   don't pass a per-message status_callback (it has no documented secret).

export type MessagingMode = "imessage" | "simulated" | "off";

export function messagingMode(): MessagingMode {
  if (
    process.env.SENDBLUE_API_KEY &&
    process.env.SENDBLUE_API_SECRET &&
    process.env.SENDBLUE_FROM_NUMBER &&
    process.env.SENDBLUE_WEBHOOK_SECRET
  ) {
    return "imessage";
  }
  return process.env.NODE_ENV === "production" ? "off" : "simulated";
}

export class TextSendError extends Error {}

export type SentText = { providerId: string; status: string };

type SendOptions = { fetcher?: typeof fetch };

// Sendblue's message statuses, as our own.
export function statusFromProvider(status: unknown): string | null {
  switch (typeof status === "string" ? status.toUpperCase() : "") {
    case "DELIVERED":
      return "delivered";
    case "SENT":
      return "sent";
    case "ERROR":
    case "DECLINED":
      return "failed";
    case "REGISTERED":
    case "PENDING":
    case "QUEUED":
    case "ACCEPTED":
      return "sent";
    default:
      return null;
  }
}

// One text through Sendblue. Throws TextSendError on anything but an accepted message, so
// the job retries. Never puts the number or the text in an error.
export async function sendViaSendblue(
  to: string,
  content: string,
  { fetcher = fetch }: SendOptions = {},
): Promise<SentText> {
  const keyId = process.env.SENDBLUE_API_KEY;
  const secret = process.env.SENDBLUE_API_SECRET;
  const from = process.env.SENDBLUE_FROM_NUMBER;
  if (!keyId || !secret || !from) throw new TextSendError("Sendblue isn't set up");
  let response: Response;
  try {
    response = await fetcher(`${SENDBLUE_API_BASE}/api/send-message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sb-api-key-id": keyId,
        "sb-api-secret-key": secret,
      },
      body: JSON.stringify({ number: to, from_number: from, content }),
      signal: AbortSignal.timeout(SENDBLUE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TextSendError(`Sendblue unreachable: ${String(error).slice(0, TEXT_ERROR_LENGTH)}`);
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const status = statusFromProvider(body?.status);
  const handle = typeof body?.message_handle === "string" ? body.message_handle : "";
  if (!response.ok || status === "failed" || !handle) {
    // error_key is Sendblue's stable reason; error_code a number. Neither holds the text.
    const reason = [body?.error_key, body?.error_code, body?.status]
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join(" ");
    throw new TextSendError(`Sendblue refused the text (HTTP ${response.status} ${reason})`);
  }
  return { providerId: handle, status: status ?? "sent" };
}

// The last two digits, for the dev log. Never the whole number.
const tail = (phone: string) => `…${phone.slice(-2)}`;

// The stand-in: nothing leaves the machine. The text is printed in the dev log only here,
// outside production, where no real person is texted.
export async function sendSimulated(to: string, content: string): Promise<SentText> {
  if (process.env.NODE_ENV === "production") throw new TextSendError("No simulated texts here");
  console.info(`[dev] Text (simulated) to ${tail(to)}: ${content}`);
  return { providerId: `sim-${randomBytes(12).toString("hex")}`, status: "delivered" };
}

export async function sendText(
  to: string,
  content: string,
  options: SendOptions = {},
): Promise<SentText> {
  const mode = messagingMode();
  if (mode === "imessage") return sendViaSendblue(to, content, options);
  if (mode === "simulated") return sendSimulated(to, content);
  throw new TextSendError("Texts aren't set up");
}

// The inbound webhook is Sendblue's only if it carries our secret in sb-signing-secret.
// No secret set means nothing is accepted.
export function webhookAuthorized(headers: Headers): boolean {
  const secret = process.env.SENDBLUE_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(headers.get("sb-signing-secret") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
