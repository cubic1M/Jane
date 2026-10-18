import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { formatCents } from "@/lib/money";
import type { DigestPayload } from "./build";

// The digest email, as HTML and plain text. Links are passed in already wrapped for
// click tracking.

export type DigestLinks = {
  report: string;
  actions: string;
  settings: string;
  unsubscribe: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const yearly = (cents: number | null) =>
  cents === null ? "" : ` (about ${formatCents(cents)} a year)`;

type Section = { heading: string; items: string[]; link?: { label: string; url: string } };

function sections(p: DigestPayload, links: DigestLinks): Section[] {
  const out: Section[] = [];
  const waiting = p.pending.filter((a) => a.status === "waiting_on_user");
  if (waiting.length > 0) {
    out.push({
      heading: "We need something from you",
      items: waiting.map((a) => `${a.title}: ${a.userTodo ?? "see your actions page"}`),
      link: { label: "Open your actions", url: links.actions },
    });
  }
  if (p.finishedThisWeek.length > 0) {
    out.push({
      heading: "Finished this week",
      items: p.finishedThisWeek.map((a) => `${a.title}${yearly(a.annualSavingsCents)}`),
    });
  }
  const working = p.pending.filter((a) => a.status !== "waiting_on_user");
  if (working.length > 0) {
    out.push({
      heading: "We're working on",
      items: working.map((a) => `${a.title}: ${ACTION_STATUS_LABELS[a.status].label}`),
      link: { label: "See all your actions", url: links.actions },
    });
  }
  if (p.newFindings.length > 0) {
    out.push({
      heading: "New since last week",
      items: p.newFindings.map((f) => `${f.title}${yearly(f.annualSavingsCents)}`),
      link: { label: "Open your report", url: links.report },
    });
  }
  return out;
}

export function renderDigest(p: DigestPayload, links: DigestLinks) {
  const headline =
    p.savedThisWeekCents > 0
      ? `You saved about ${formatCents(p.savedThisWeekCents)} a year this week`
      : "Your week in money";
  const totals = [
    `Saved so far: about ${formatCents(p.savedToDateCents)} a year`,
    `Still to look at: ${formatCents(p.moneyFoundCents)} a year`,
  ];
  const body = sections(p, links);

  const text = [
    headline,
    "",
    ...totals,
    ...body.flatMap((s) => [
      "",
      s.heading,
      ...s.items.map((i) => `- ${i}`),
      ...(s.link ? [`${s.link.label}: ${s.link.url}`] : []),
    ]),
    "",
    `Email settings: ${links.settings}`,
    `Unsubscribe: ${links.unsubscribe}`,
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b;line-height:1.5">
<h1 style="font-size:22px">${escapeHtml(headline)}</h1>
${totals.map((t) => `<p style="margin:4px 0">${escapeHtml(t)}</p>`).join("\n")}
${body
  .map(
    (s) => `<h2 style="font-size:17px;margin-top:24px">${escapeHtml(s.heading)}</h2>
<ul>${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>${
      s.link
        ? `\n<p><a href="${escapeHtml(s.link.url)}" style="color:#047857">${escapeHtml(s.link.label)}</a></p>`
        : ""
    }`,
  )
  .join("\n")}
<p style="margin-top:32px;font-size:12px;color:#71717a"><a href="${escapeHtml(links.settings)}" style="color:#71717a">Email settings</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#71717a">Unsubscribe</a></p>
</div>`;

  return { subject: headline, text, html };
}
