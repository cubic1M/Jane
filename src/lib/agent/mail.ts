import { sendEmail } from "@/lib/email";
import { isTrialUser } from "@/lib/trial-ids";

// How the action agent's email leaves. With email set up (RESEND_API_KEY, EMAIL_FROM and
// AGENT_INBOUND_DOMAIN), real email goes out from Jane's address with a reply-to address
// unique to the action. Without it, outside production, a simulated company mailbox
// answers instead (src/lib/agent/simulated-company.ts), so the whole loop runs in
// development and tests. In production without it, the agent hands every action to the
// team rather than pretend.

export type MailMode = "email" | "simulated" | "off";

// Spec step 138: a trial person's requests always go to the simulated company.
export function mailMode(userId?: string): MailMode {
  if (isTrialUser(userId)) return "simulated";
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.AGENT_INBOUND_DOMAIN) {
    return "email";
  }
  return process.env.NODE_ENV === "production" ? "off" : "simulated";
}

// The address a company's reply goes to: unique per action, so it finds its way back.
export function replyAddress(token: string): string {
  const domain = process.env.AGENT_INBOUND_DOMAIN ?? "agent.jane.test";
  return `reply+${token}@${domain}`;
}

// The token in a reply address, or null if it isn't one of ours.
export function tokenFromAddress(address: string): string | null {
  const match = /reply\+([a-z0-9]{20,40})@/i.exec(address);
  return match ? match[1] : null;
}

export function agentFromAddress(): string {
  return process.env.EMAIL_FROM ?? "Jane <agent@jane.test>";
}

export type OutgoingMail = { to: string; subject: string; text: string; replyTo: string };

export async function sendAgentMail(mail: OutgoingMail): Promise<void> {
  if (mailMode() !== "email") throw new Error("Agent email isn't set up");
  await sendEmail({
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${mail.text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre>`,
    replyTo: mail.replyTo,
  });
}
