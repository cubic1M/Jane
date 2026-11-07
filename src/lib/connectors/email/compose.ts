// "You send it" email (connectors roadmap round 19, user_sends_email): Resend's acceptable-use policy
// (updated 2026-10-13) bans "unsolicited messages of any kind, including cold outreach", and
// AgentMail refuses it too, so a first email to a company goes out from the person's own address.
// Jane fills it in and hands over links that open it ready to send: a mailto, and Gmail's and
// Outlook's compose pages. Every value is encoded, and an address or subject with a line break is
// refused, so nothing can add a header. Pure.

export type Draft = { to: string; subject: string; body: string; bcc?: string | null };

export type ComposeLinks = { mailto: string; gmail: string; outlook: string };

const ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export function composeLinks(draft: Draft): ComposeLinks {
  const { to, subject, body } = draft;
  const bcc = draft.bcc ?? null;
  if (!ADDRESS.test(to) || (bcc !== null && !ADDRESS.test(bcc))) {
    throw new Error("Not an email address");
  }
  if (/[\r\n]/.test(subject)) throw new Error("A subject can't have a line break");
  const e = encodeURIComponent;
  const mailto = `mailto:${e(to)}?subject=${e(subject)}&body=${e(body)}${bcc ? `&bcc=${e(bcc)}` : ""}`;
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${e(to)}&su=${e(subject)}&body=${e(body)}${bcc ? `&bcc=${e(bcc)}` : ""}`;
  // Outlook's compose link takes no Bcc: from Outlook the person forwards the reply to Jane instead.
  const outlook = `https://outlook.live.com/mail/0/deeplink/compose?to=${e(to)}&subject=${e(subject)}&body=${e(body)}`;
  return { mailto, gmail, outlook };
}

// Who sends an email to a company (round 19, email_send_gate): Jane only to a company marked as
// taking email from an assistant, or on a thread the company opened; anyone else hears from the
// person themselves. No large consumer brand publishes that it takes agent email (round 19), so for
// now it's the person every time a thread starts.
export function emailSender(company: {
  acceptsAgentEmail?: boolean;
  companyOpenedThread?: boolean;
}): "jane" | "person" {
  return company.acceptsAgentEmail === true || company.companyOpenedThread === true
    ? "jane"
    : "person";
}
