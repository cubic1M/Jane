import { sendEmail } from "@/lib/email";
import { isSampleTrialUser, isStatementTrialUser } from "@/lib/trial-ids";

// How the action agent's email leaves. With email set up (RESEND_API_KEY, EMAIL_FROM and
// AGENT_INBOUND_DOMAIN), real email goes out from Jane's address with a reply-to address
// unique to the action. Without it, outside production, a simulated company mailbox
// answers instead (src/lib/agent/simulated-company.ts), so the whole loop runs in
// development and tests. In production without it, the agent hands every action to the
// team rather than pretend.

export type MailMode = "email" | "simulated" | "off";

// Spec step 138: a sample person's requests always go to the simulated company. Someone trying
// Jane with their own statement never writes to any company, real or simulated.
export function mailMode(userId?: string): MailMode {
  if (isStatementTrialUser(userId)) return "off";
  if (isSampleTrialUser(userId)) return "simulated";
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.AGENT_INBOUND_DOMAIN) {
    return "email";
  }
  // SIMULATED_AGENT=1: a production build that must still simulate (the end-to-end tests).
  return process.env.NODE_ENV === "production" && process.env.SIMULATED_AGENT !== "1"
    ? "off"
    : "simulated";
}

// The address a company's reply goes to: unique per action, so it finds its way back.
export function replyAddress(token: string): string {
  const domain = process.env.AGENT_INBOUND_DOMAIN ?? "agent.jane.test";
  return `reply+${token}@${domain}`;
}

// The domain an address is at, from "Name <someone@help.example.com>" or a bare address, as its
// last two labels (help.example.com and example.com are the same company). Null if none.
function companyDomain(address: string): string | null {
  const match = /@([a-z0-9.-]+\.[a-z]{2,})>?\s*$/i.exec(address.trim());
  return match ? match[1].toLowerCase().split(".").slice(-2).join(".") : null;
}

// Whether a reply comes from the company Jane wrote to: the same domain as the address it sent
// to. The token in the reply address is in every email to them, so anyone in that thread holds
// it; it finds the action, and this decides whether the reply is acted on.
export function fromTheCompany(from: string, sentTo: string): boolean {
  const domain = companyDomain(from);
  return domain !== null && domain === companyDomain(sentTo);
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
