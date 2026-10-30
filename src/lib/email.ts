import { isTrialEmail } from "@/lib/trial-ids";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string;
};

// Resend's id for a sent email, so its webhook events (an open, a bounce) can be matched back.
export type SentEmail = { id: string | null };

export async function sendEmail({
  to,
  subject,
  html,
  text,
  headers,
  replyTo,
}: Email): Promise<SentEmail | void> {
  // Spec step 138: a trial person's address can never receive mail; nothing is sent.
  if (isTrialEmail(to)) return;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM must be set");

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      ...(headers ? { headers } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { id: typeof body?.id === "string" ? body.id : null };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function sendMagicLink({ to, url }: { to: string; url: string }): Promise<void> {
  // Local dev without Resend: print the link instead. Never in production, where the
  // link is a credential and must only go to the user's inbox.
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
    console.info(`[dev] Magic link for ${to}: ${url}`);
    return;
  }

  const link = escapeHtml(url);
  await sendEmail({
    to,
    subject: "Your sign-in link for Jane",
    text: `Sign in to Jane:\n${url}\n\nThis link expires in 24 hours and works once. If you didn't ask for it, ignore this email.`,
    html: `<p>Sign in to Jane:</p>
<p><a href="${link}">Sign in</a></p>
<p>This link expires in 24 hours and works once. If you didn't ask for it, ignore this email.</p>`,
  });
}
