import { ALERT_LABELS } from "@/config/alerts";
import type { AlertType } from "@/generated/prisma/client";

// One urgent alert as an email, HTML and plain text.

export type AlertEmailLinks = { alerts: string; settings: string; unsubscribe: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderAlertEmail(
  alert: { type: AlertType; title: string; body: string },
  links: AlertEmailLinks,
) {
  const label = ALERT_LABELS[alert.type].label;
  const subject = `${label}: ${alert.title}`;
  const text = [
    alert.title,
    "",
    alert.body,
    "",
    `See your alerts: ${links.alerts}`,
    "",
    `Choose which alerts we email: ${links.settings}`,
    `Stop alert emails: ${links.unsubscribe}`,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#171717;line-height:1.5">
<p style="font-size:13px;color:#737373;margin:0">${escapeHtml(label)}</p>
<h1 style="font-size:20px">${escapeHtml(alert.title)}</h1>
<p>${escapeHtml(alert.body)}</p>
<p><a href="${escapeHtml(links.alerts)}" style="color:#171717">See your alerts</a></p>
<p style="margin-top:32px;font-size:12px;color:#737373"><a href="${escapeHtml(links.settings)}" style="color:#737373">Choose which alerts we email</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#737373">Stop alert emails</a></p>
</div>`;
  return { subject, text, html };
}
