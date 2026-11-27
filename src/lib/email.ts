import { OUTSIDE_CALL_TIMEOUT_MS } from "@/config/outside-calls";
import { linkOnSite } from "@/lib/site-origin";
import { killed } from "@/config/kill-switches";
import { log } from "@/lib/log";
import { freshSwitches } from "@/lib/ops-switches";
import { isTrialEmail } from "@/lib/trial-ids";
import { escapeHtml } from "@/lib/escape-html";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// How long a sign-in link works. The emails and /login/check-email say so in words.
export const SIGN_IN_LINK_HOURS = 1;

type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string;
};

// Words from Resend, for the log and for errors: its messages can name the address ("send testing
// emails to your own email address (you@…)") and carry links, and neither belongs on a log.
const MAX_DETAIL_CHARS = 300;
function safeDetail(body: string): string {
  let words = body;
  try {
    const parsed = JSON.parse(body) as { name?: unknown; message?: unknown };
    if (typeof parsed.message === "string") {
      words =
        typeof parsed.name === "string" ? `${parsed.name}: ${parsed.message}` : parsed.message;
    }
  } catch {
    // Not JSON (a gateway's page): the words as they came, scrubbed and cut short below.
  }
  return words
    .replace(/https?:\/\/\S+/g, "<link>")
    .replace(/[^\s@<>()"']+@[^\s@<>()"']+/g, "<address>")
    .slice(0, MAX_DETAIL_CHARS);
}

// The provider's id for a sent email (Resend's, or AgentMail's message id), so its webhook events
// (an open, a bounce) can be matched back.
export type SentEmail = { id: string | null };

// AgentMail, the second sender (EMAIL_PROVIDER=agentmail): it sends from an inbox address it gives
// (AGENTMAIL_INBOX_ID, like jane-reports@agentmail.to), so no domain of ours has to be verified.
// Same interface, same guards above it (trial addresses, the kill switch). Headers pass through,
// so the one-click unsubscribe works. docs/email-senders.md says what it costs and keeps.
const AGENTMAIL_ENDPOINT = "https://api.agentmail.to/v0/inboxes";

async function sendViaAgentMail({ to, subject, html, text, headers, replyTo }: Email) {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  const inbox = process.env.AGENTMAIL_INBOX_ID;
  if (!apiKey || !inbox) throw new Error("AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID must be set");
  const response = await fetch(`${AGENTMAIL_ENDPOINT}/${encodeURIComponent(inbox)}/messages/send`, {
    method: "POST",
    signal: AbortSignal.timeout(OUTSIDE_CALL_TIMEOUT_MS),
    redirect: "error",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      to,
      subject,
      html,
      text,
      ...(headers ? { headers } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `AgentMail rejected the email (${response.status}): ${safeDetail(await response.text())}`,
    );
  }
  const body = (await response.json().catch(() => null)) as { message_id?: unknown } | null;
  return { id: typeof body?.message_id === "string" ? body.message_id : null };
}

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
  // The emergency stop (docs/incident.md): it fails, so whatever was sending knows it didn't go.
  await freshSwitches();
  if (killed("email")) throw new Error("Email is paused (KILL_EMAIL)");
  if (process.env.EMAIL_PROVIDER === "agentmail") {
    return sendViaAgentMail({ to, subject, html, text, headers, replyTo });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM must be set");

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(OUTSIDE_CALL_TIMEOUT_MS),
    redirect: "error",
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
    throw new Error(
      `Resend rejected the email (${response.status}): ${safeDetail(await response.text())}`,
    );
  }
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { id: typeof body?.id === "string" ? body.id : null };
}

export async function sendMagicLink({
  to,
  url: asked,
}: {
  to: string;
  url: string;
}): Promise<void> {
  // Auth.js builds the link from the request's headers: it goes out on the site's own address.
  const url = linkOnSite(asked);
  // Local dev without Resend: print the link instead. Never in production, where the
  // link is a credential and must only go to the user's inbox.
  if (
    !process.env.RESEND_API_KEY &&
    process.env.EMAIL_PROVIDER !== "agentmail" &&
    process.env.NODE_ENV !== "production"
  ) {
    log.dev(`[dev] Magic link for ${to}: ${url}`);
    return;
  }

  const link = escapeHtml(url);
  try {
    await sendEmail({
      to,
      subject: "Your sign-in link for Jane",
      text: `Sign in to Jane:\n${url}\n\nThis link expires in an hour and works once. If you didn't ask for it, ignore this email.`,
      html: `<p>Sign in to Jane:</p>
  <p><a href="${link}">Sign in</a></p>
  <p>This link expires in an hour and works once. If you didn't ask for it, ignore this email.</p>`,
    });
  } catch (error) {
    // Auth.js logs only "Error": why a sign-in email failed is said here, once, with no address or
    // link in it. The address can be in a failure from anywhere, so it's scrubbed again.
    const words = error instanceof Error ? error.message : "unknown";
    log.error("[magic-link] send failed:", safeDetail(words));
    throw error;
  }
}
