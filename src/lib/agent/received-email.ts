import { OUTSIDE_CALL_TIMEOUT_MS } from "@/config/outside-calls";

// A company's reply as Resend received it, read from Resend by the id its signed `email.received`
// webhook names: the webhook carries only metadata, and it's the stored email that says whether
// the sender was who it claims. `authentication` is "the SPF, DKIM, and DMARC results computed when
// the email was received", which "come from the receiving mail server, not from the message
// headers, so the sender cannot forge them" (resend.com/docs/api-reference/emails/
// retrieve-received-email, 2026-11-05).

const RECEIVED_ENDPOINT = "https://api.resend.com/emails/receiving";

export type ReceivedEmail = {
  to: string[];
  from: string;
  subject: string;
  text: string;
  // DMARC passed: the From line's domain is the one that sent or signed it.
  verified: boolean;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export async function readReceivedEmail(
  emailId: string,
  { fetcher = fetch }: { fetcher?: typeof fetch } = {},
): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !/^[A-Za-z0-9_-]{1,100}$/.test(emailId)) return null;
  const response = await fetcher(`${RECEIVED_ENDPOINT}/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(OUTSIDE_CALL_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return null;
  const auth = (body.authentication ?? {}) as { dmarc?: unknown };
  return {
    to: [...strings(body.to), ...strings(body.received_for)],
    from: typeof body.from === "string" ? body.from : "",
    subject: typeof body.subject === "string" ? body.subject : "",
    text: typeof body.text === "string" ? body.text : "",
    verified: auth.dmarc === "pass",
  };
}
