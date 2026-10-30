import { BACK_OR_AGREED, SAVED_SO_FAR_LABEL } from "@/lib/saved-amount";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { SUGGESTION_CONFIDENCE_FROM } from "@/config/priorities";
import type { Confidence } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";
import type { DigestCheckup, DigestPayload } from "./build";

// The digest email, as HTML and plain text. Links are passed in already wrapped for
// click tracking.

export type DigestLinks = {
  plan: string;
  report: string;
  actions: string;
  alerts: string;
  budgets: string;
  goals: string;
  netWorth: string;
  // The monthly close (/close): what Jane found, what was verified, what changed.
  close: string;
  settings: string;
  unsubscribe: string;
  // A one-tap link for this week's no-risk items (spec step 60), when there are any.
  goAhead?: { url: string; count: number };
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

// How sure, after each line: "(84% sure)". A finding stores a level, which is the band its
// percentage fell in (SUGGESTION_CONFIDENCE_FROM), so it says that band.
const sure = (percent: number | null | undefined) =>
  typeof percent === "number" ? ` (${percent}% sure)` : "";
const levelSure = (level: Confidence | undefined) => {
  const { high, medium } = SUGGESTION_CONFIDENCE_FROM;
  if (level === "high") return ` (${high}%+ sure)`;
  if (level === "medium") return ` (${medium}–${high - 1}% sure)`;
  if (level === "low") return ` (under ${medium}% sure)`;
  return "";
};

// A change's title ends with a full stop; the "(84% sure)" after it ends the line instead.
const fact = (title: string) => title.replace(/\.$/, "");

// The things that changed this week: the alerts and the changes Jane noticed.
export const changedCount = (p: DigestPayload) =>
  (p.alerts?.length ?? 0) + (p.changes?.length ?? 0);

export function checkupLine(c: DigestCheckup): string {
  const parts = [
    c.found > 0 && `${c.found} found something`,
    c.passed > 0 && `${c.passed} found nothing wrong`,
    c.notEnoughData > 0 &&
      `${c.notEnoughData} ${c.notEnoughData === 1 ? "needs" : "need"} more data`,
  ].filter((part): part is string => typeof part === "string");
  return `Jane ran ${c.checks} ${c.checks === 1 ? "check" : "checks"}: ${parts.join(", ")}.`;
}

// Under every email: these are facts from the person's own accounts.
export const FACTS_NOT_ADVICE =
  "Facts from your own accounts, with how sure Jane is of each. Not financial advice.";

type Section = { heading: string; items: string[]; link?: { label: string; url: string } };

function sections(p: DigestPayload, links: DigestLinks): Section[] {
  const out: Section[] = [];
  // First, what changed: each line a fact with how sure Jane is, and one link to see it.
  // Older payloads (stored before alerts existed) have no alerts list.
  if (changedCount(p) > 0) {
    out.push({
      heading: "What changed",
      items: [
        ...(p.alerts ?? []).map((a) => `${fact(a.title)}${sure(a.percent)}`),
        ...(p.changes ?? []).map((c) => `${fact(c.title)}${sure(c.percent)}`),
      ],
      link: { label: "See it in Jane", url: links.alerts },
    });
  }
  const waiting = p.pending.filter((a) => a.status === "waiting_on_user");
  if (waiting.length > 0) {
    out.push({
      heading: "We need something from you",
      items: waiting.map((a) => `${a.title}: ${a.userTodo ?? "see your actions page"}`),
      link: { label: "Open your actions", url: links.actions },
    });
  }
  if (links.goAhead) {
    const n = links.goAhead.count;
    out.push({
      heading: "Go ahead in one tap",
      items: [
        `Jane is ready to go ahead with ${n} ${n === 1 ? "thing" : "things"} that can't cost you anything. You can take it back for an hour.`,
      ],
      link: { label: `Go ahead with ${n}`, url: links.goAhead.url },
    });
  }
  if (p.plan && p.plan.items > 0) {
    const n = p.plan.items;
    out.push({
      heading: "Jane's plan this week",
      items: [
        p.plan.readOnly
          ? // As /plan says it in read-only mode (night QA 10-30: the email said "Jane can do
            // for you" to people Jane does nothing for).
            `${n} ${n === 1 ? "thing" : "things"} you could do, each with Jane's steps. Nothing changes unless you do it.`
          : `${n} ${n === 1 ? "thing" : "things"} Jane can do for you. Say yes, no or change each one; nothing happens until you do.`,
      ],
      link: { label: "Review your plan", url: links.plan },
    });
  }
  const did = p.janeDid;
  if (did && (did.finished > 0 || did.contacts > 0 || did.working > 0)) {
    out.push({
      heading: "What Jane did for you this week",
      items: [
        did.finished > 0 &&
          `Finished ${did.finished} ${did.finished === 1 ? "thing" : "things"}${
            did.confirmedCents > 0
              ? `, with ${formatCents(did.confirmedCents)} ${BACK_OR_AGREED}`
              : ""
          }.`,
        did.contacts > 0 &&
          `Wrote or called ${did.contacts} ${did.contacts === 1 ? "time" : "times"} on your behalf.`,
        did.working > 0 && `Still working on ${did.working}.`,
        did.waiting > 0 &&
          `${did.waiting} ${did.waiting === 1 ? "thing needs" : "things need"} something from you.`,
      ].filter((line): line is string => typeof line === "string"),
      link: { label: "See every step", url: links.actions },
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
      items: p.newFindings.map(
        (f) => `${f.title}${yearly(f.annualSavingsCents)}${levelSure(f.confidence)}`,
      ),
      link: { label: "Open your report", url: links.report },
    });
  }
  if (p.checkup) {
    out.push({
      heading: "Jane's checkup",
      items: [checkupLine(p.checkup)],
      link: { label: "See every check", url: links.report },
    });
  }
  if (p.budgets?.length) {
    out.push({
      heading: "Budgets this month",
      items: p.budgets.map(
        (b) =>
          `${b.category}: ${formatCents(b.spentCents)} of ${formatCents(b.budgetCents)}${b.over ? " (over)" : ""}`,
      ),
      link: { label: "See your budgets", url: links.budgets },
    });
  }
  if (p.goals?.length) {
    out.push({
      heading: "Your goals",
      items: p.goals.map((g) => {
        const change =
          g.savedChangeCents === null || g.savedChangeCents === 0
            ? ""
            : ` (${g.savedChangeCents > 0 ? "+" : "−"}${formatCents(Math.abs(g.savedChangeCents))} this week)`;
        return `${g.name}: ${g.percent}%${change}`;
      }),
      link: { label: "See your goals", url: links.goals },
    });
  }
  if (p.netWorth) {
    const { nowCents, changeCents, notCounting } = p.netWorth;
    const direction =
      changeCents === 0
        ? "no change this week"
        : `${changeCents > 0 ? "up" : "down"} ${formatCents(Math.abs(changeCents))} this week`;
    out.push({
      heading: "Net worth",
      items: [`${formatCents(nowCents)}, ${direction}${notCounting ? ` (${notCounting})` : ""}`],
      link: { label: "See your net worth", url: links.netWorth },
    });
  }
  if (p.membershipOffer) {
    out.push({
      heading: "We'll keep doing this for you, ongoing",
      items: ["Become a founding member, or reserve your spot for free."],
      link: { label: "See membership", url: links.actions },
    });
  }
  return out;
}

export function renderDigest(p: DigestPayload, links: DigestLinks) {
  const changed = changedCount(p);
  const headline =
    changed > 0
      ? `${changed} ${changed === 1 ? "thing" : "things"} changed in your money this week`
      : p.savedThisWeekCents > 0
        ? `You saved about ${formatCents(p.savedThisWeekCents)} a year this week`
        : "Your week in money";
  // Nothing saved yet (the read-only beta, where people act themselves) says nothing.
  const totals = [
    p.savedToDateCents > 0 &&
      `${SAVED_SO_FAR_LABEL}: about ${formatCents(p.savedToDateCents)} a year`,
    // Nor "Still to look at: $0.00 a year" when what's left has no dollar estimate (night QA
    // 10-30: an insurance reshop on its own).
    p.moneyFoundCents > 0 && `Still to look at: ${formatCents(p.moneyFoundCents)} a year`,
  ].filter((line): line is string => typeof line === "string");
  const body = sections(p, links);
  const close = { label: "See your monthly close", url: links.close };

  const text = [
    headline,
    "",
    ...totals,
    `${close.label}: ${close.url}`,
    ...body.flatMap((s) => [
      "",
      s.heading,
      ...s.items.map((i) => `- ${i}`),
      ...(s.link ? [`${s.link.label}: ${s.link.url}`] : []),
    ]),
    "",
    FACTS_NOT_ADVICE,
    `Email settings: ${links.settings}`,
    `Unsubscribe: ${links.unsubscribe}`,
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#171717;line-height:1.5">
<h1 style="font-size:22px">${escapeHtml(headline)}</h1>
${totals.map((t) => `<p style="margin:4px 0">${escapeHtml(t)}</p>`).join("\n")}
<p style="margin:4px 0"><a href="${escapeHtml(close.url)}" style="color:#171717">${escapeHtml(close.label)}</a></p>
${body
  .map(
    (s) => `<h2 style="font-size:17px;margin-top:24px">${escapeHtml(s.heading)}</h2>
<ul>${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>${
      s.link
        ? `\n<p><a href="${escapeHtml(s.link.url)}" style="color:#171717">${escapeHtml(s.link.label)}</a></p>`
        : ""
    }`,
  )
  .join("\n")}
<p style="margin-top:32px;font-size:12px;color:#737373">${escapeHtml(FACTS_NOT_ADVICE)}</p>
<p style="font-size:12px;color:#737373"><a href="${escapeHtml(links.settings)}" style="color:#737373">Email settings</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#737373">Unsubscribe</a></p>
</div>`;

  return { subject: headline, text, html };
}
