import type { ActionStatus } from "@/generated/prisma/client";
import { sendEmail } from "@/lib/email";

// Emails the person gets when the team moves one of their actions. Failure reasons stay
// internal; the person gets a plain note and can reply.

const APP_NAME = "Financial Controller";

function appUrl(path: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type StatusEmail = { subject: string; lines: string[] };

export const MEMBERSHIP_LINE =
  "We'll keep doing this for you, ongoing. See your actions page to become a founding member.";

export function statusEmail(
  status: ActionStatus,
  title: string,
  userTodo: string | null,
  { membershipOffer = false }: { membershipOffer?: boolean } = {},
): StatusEmail | null {
  switch (status) {
    case "in_progress":
      return { subject: `We're working on it: ${title}`, lines: [`We've started on "${title}".`] };
    case "waiting_on_user":
      return {
        subject: `We need something from you: ${title}`,
        lines: [`To finish "${title}", we need you to:`, userTodo ?? "Check your actions page."],
      };
    case "done":
      return {
        subject: `Done: ${title}`,
        lines: [`"${title}" is finished.`, ...(membershipOffer ? [MEMBERSHIP_LINE] : [])],
      };
    case "failed":
      return {
        subject: `We couldn't finish: ${title}`,
        lines: [
          `We weren't able to complete "${title}". Reply to this email if you'd like us to try another way.`,
        ],
      };
    case "queued":
      return null;
  }
}

export async function sendStatusEmail(to: string, email: StatusEmail): Promise<void> {
  const link = appUrl("/actions");
  const text = [...email.lines, "", `See all your actions: ${link}`].join("\n");
  // Local dev without Resend: print instead of sending.
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
    console.info(`[dev] Email to ${to}: ${email.subject}\n${text}`);
    return;
  }
  await sendEmail({
    to,
    subject: `${email.subject} | ${APP_NAME}`,
    text,
    html: `${email.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
<p><a href="${escapeHtml(link)}">See all your actions</a></p>`,
  });
}
