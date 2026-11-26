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

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    // Each reference is decoded once, in one pass: "&amp;#36;" is the text "&#36;", not "$".
    .replace(
      /&(?:(amp|lt|gt|quot|apos|nbsp)|#(x[0-9a-f]{1,6}|\d{1,7}));/gi,
      (m, name?: string, code?: string) => {
        if (name) return ENTITIES[name.toLowerCase()];
        const point = code![0].toLowerCase() === "x" ? parseInt(code!.slice(1), 16) : Number(code);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : m;
      },
    )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export async function readReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !/^[A-Za-z0-9_-]{1,100}$/.test(emailId)) return null;
  const response = await fetch(`${RECEIVED_ENDPOINT}/${emailId}`, {
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
    // An HTML-only reply has no text part: its words, tags removed, so the reply reader never gets
    // just the subject line.
    text:
      typeof body.text === "string" && body.text.trim()
        ? body.text
        : typeof body.html === "string"
          ? htmlToText(body.html)
          : "",
    verified: auth.dmarc === "pass",
  };
}
