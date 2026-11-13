import { escapeHtml } from "@/lib/escape-html";
import { sendEmail } from "@/lib/email";
import { teamEmails } from "@/lib/health";
import { log } from "@/lib/log";
import { siteOrigin } from "@/lib/site-origin";

// A beta tester's feedback, emailed to the founders (ADMIN_EMAILS) as it arrives. Only what the
// person wrote and the page's path: never a balance, a transaction, an account or the screenshot
// (it can show their money, so it stays encrypted on /admin/reports). Replying answers the person.
// Never throws: the report is already saved, and /admin/reports lists it either way.
export async function emailFeedback(
  report: { path: string; message: string; screenshot: boolean; replyTo: string | null },
  { send = sendEmail }: { send?: typeof sendEmail } = {},
): Promise<boolean> {
  const to = teamEmails();
  if (to.length === 0) return false;
  const link = `${siteOrigin() ?? ""}/admin/reports`;
  const extra = report.screenshot ? "A screenshot is attached on /admin/reports." : null;
  const text = [
    `Feedback from a beta tester, on ${report.path}:`,
    report.message,
    ...(extra ? [extra] : []),
    `All feedback: ${link}`,
    ...(report.replyTo ? ["Reply to this email to answer them."] : []),
  ].join("\n\n");
  const html = `<p>Feedback from a beta tester, on <code>${escapeHtml(report.path)}</code>:</p><blockquote style="white-space:pre-wrap">${escapeHtml(report.message)}</blockquote>${extra ? `<p>${escapeHtml(extra)}</p>` : ""}<p>All feedback: <a href="${escapeHtml(link)}">/admin/reports</a></p>${report.replyTo ? "<p>Reply to this email to answer them.</p>" : ""}`;
  try {
    await Promise.all(
      to.map((address) =>
        send({
          to: address,
          subject: `Jane feedback: ${report.path}`,
          text,
          html,
          ...(report.replyTo ? { replyTo: report.replyTo } : {}),
        }),
      ),
    );
    return true;
  } catch (error) {
    log.error("Feedback email failed", { error: String(error) });
    return false;
  }
}
