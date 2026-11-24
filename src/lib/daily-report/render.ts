import { DAILY_REPORT_UTM } from "@/config/daily-report";
import { appBase } from "@/lib/digest/links";
import { FACTS_NOT_ADVICE } from "@/lib/digest/render";
import { escapeHtml } from "@/lib/escape-html";
import type { DailyReport } from "./build";

// The daily report as an email, HTML and plain text. Links go to pages of the app with the
// campaign's UTM tags and nothing about the person in them.

export type DailyReportLinks = { settings: string; unsubscribe: string };

// A page of the app, as a link. Only a plain path counts ("/subscriptions"): anything else goes home.
export function reportLink(path: string): string {
  const plain = /^\/[a-z0-9/-]*$/i.test(path) && !path.includes("//") ? path : "/home";
  return `${appBase()}${plain}?${new URLSearchParams(DAILY_REPORT_UTM)}`;
}

const WHY = "You get this because you turned on the daily report in Jane's settings.";

export function renderDailyReport(report: DailyReport, links: DailyReportLinks) {
  const text = [
    report.title,
    ...report.sections.flatMap((s) => [
      "",
      s.heading,
      ...s.items.flatMap((i) => [`- ${i.text}`, ...(i.path ? [`  ${reportLink(i.path)}`] : [])]),
    ]),
    "",
    FACTS_NOT_ADVICE,
    WHY,
    `Daily report settings: ${links.settings}`,
    `Stop the daily report: ${links.unsubscribe}`,
  ].join("\n");

  const item = (i: DailyReport["sections"][number]["items"][number]) =>
    i.path
      ? `<li><a href="${escapeHtml(reportLink(i.path))}" style="color:#171717">${escapeHtml(i.text)}</a></li>`
      : `<li>${escapeHtml(i.text)}</li>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#171717;line-height:1.5">
<h1 style="font-size:20px">${escapeHtml(report.title)}</h1>
${report.sections
  .map(
    (s) => `<h2 style="font-size:16px;margin-top:20px">${escapeHtml(s.heading)}</h2>
<ul>${s.items.map(item).join("")}</ul>`,
  )
  .join("\n")}
<p style="margin-top:32px;font-size:12px;color:#737373">${escapeHtml(FACTS_NOT_ADVICE)}</p>
<p style="font-size:12px;color:#737373">${escapeHtml(WHY)} <a href="${escapeHtml(links.settings)}" style="color:#737373">Daily report settings</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#737373">Stop the daily report</a></p>
</div>`;

  return { subject: report.subject, text, html };
}
