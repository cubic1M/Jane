import { CHAT_WEEK_DAYS, WHOLE_PICTURE_DUE, WHOLE_PICTURE_TOP } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { Ranked } from "@/planning/priorities";
import type { MessageAction, MessageRefs } from "./types";
import type { Reply } from "./replies";
import type { Snapshot } from "./snapshot";
import { dateAndDays, inDays, sentence, things } from "./sources/source";
import { shortName } from "./sources/findings";

// "Am I OK?" and "what should I do this month?" answered whole (spec step 183), from every
// sector at once: safe to spend (with the payday, step 182), what's due, budgets and goals,
// urgent alerts, what Jane's agent is doing and the ranked next things (step 143). The
// answer comes first; the one to three things that matter follow, the first with its Yes.
// Pure: Jane's snapshot and ranked list in, one reply out. Claude's whole_picture tool
// gives Claude the same facts (wholePicture below).

export type Focus = "now" | "month";

export type WholePicture = {
  verdict: "ok" | "watch" | "act";
  // The verdict as one sentence, answer first.
  headline: string;
  safe: { safeCents: number; payday: string | null } | null;
  due: { label: string; date: string; amountCents: number | null; href: string }[];
  budgetsOver: { category: string; overCents: number }[];
  goalsBehind: { name: string; leftCents: number }[];
  urgent: string[];
  // Jane's agent: yeses it's working on, and the steps only the person can do.
  working: number;
  waitingOnYou: number;
  // Ticked, no-risk plan items "Approve all safe ones" would approve.
  safeItems: number;
  top: Ranked[];
};

const DAY_MS = 86_400_000;
const daysToMonthEnd = (asOf: string) => {
  const d = new Date(`${asOf}T00:00:00Z`);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
  return Math.round((end - d.getTime()) / DAY_MS);
};

export function wholePicture(snapshot: Snapshot, ranked: Ranked[], focus: Focus): WholePicture {
  const asOf = snapshot.asOf;
  const horizon = focus === "month" ? daysToMonthEnd(asOf) : CHAT_WEEK_DAYS;
  const due = snapshot.comingUp
    .filter((r) => r.daysLeft >= 0 && r.daysLeft <= horizon)
    .slice(0, WHOLE_PICTURE_DUE)
    .map((r) => ({ label: r.label, date: r.date, amountCents: r.amountCents, href: r.href }));
  // Dated deadlines are already in what's due.
  const top = ranked.filter((r) => r.kind !== "deadline").slice(0, WHOLE_PICTURE_TOP);
  const safe = snapshot.safeToSpend;
  const urgent = snapshot.urgentAlerts.map((a) => a.title);
  const budgetsOver = snapshot.budgetsOver.map((b) => ({
    category: b.category,
    overCents: b.overCents,
  }));
  const goalsBehind = snapshot.goalsBehind.map((g) => ({ name: g.name, leftCents: g.leftCents }));

  const until = safe?.payday ? ` until payday, ${dateAndDays(safe.payday, asOf)}` : " this month";
  const money = safe ? `you have ${formatCents(safe.safeCents)} safe to spend${until}` : null;
  const worry = budgetsOver[0]
    ? `you're ${formatCents(budgetsOver[0].overCents)} over your ${budgetsOver[0].category} budget`
    : goalsBehind[0]
      ? `your goal "${goalsBehind[0].name}" still has ${formatCents(goalsBehind[0].leftCents)} to go`
      : null;

  let verdict: WholePicture["verdict"];
  let headline: string;
  if (safe && safe.safeCents < 0) {
    verdict = "act";
    headline = `Not quite: you're short by ${formatCents(-safe.safeCents)}${until}, after your bills.`;
  } else if (urgent.length > 0) {
    verdict = "act";
    const alert = urgent[0].replace(/[.!?]+$/, "");
    headline = money ? `Not quite: ${alert}. Otherwise ${money}.` : `Not quite: ${alert}.`;
  } else if (worry) {
    verdict = "watch";
    headline = money ? `Mostly: ${money}, but ${worry}.` : `Mostly, but ${worry}.`;
  } else {
    verdict = "ok";
    headline = money
      ? `Yes, you're OK: ${money}, and nothing is overdue.`
      : "Yes, you're OK: nothing is overdue and nothing urgent is waiting.";
  }
  return {
    verdict,
    headline,
    safe,
    due,
    budgetsOver,
    goalsBehind,
    urgent,
    working: snapshot.working ?? 0,
    waitingOnYou: snapshot.waitingOnYou.length,
    safeItems: snapshot.plan.safeItems,
    top,
  };
}

function dueLine(picture: WholePicture, asOf: string, focus: Focus): string {
  const when = focus === "month" ? "before the month ends" : `in the next ${CHAT_WEEK_DAYS} days`;
  if (picture.due.length === 0) return `Nothing is due ${when}.`;
  const days = (date: string) =>
    Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS);
  return `Due ${when}: ${picture.due
    .map(
      (d) =>
        `${d.label}${d.amountCents === null ? "" : ` ${formatCents(d.amountCents)}`} ${inDays(days(d.date))}`,
    )
    .join(", ")}.`;
}

function janeLine(picture: WholePicture): string | null {
  const parts: string[] = [];
  if (picture.working > 0) parts.push(`I'm working on ${things(picture.working)} for you`);
  if (picture.waitingOnYou > 0)
    parts.push(
      `${things(picture.waitingOnYou)} ${picture.waitingOnYou === 1 ? "needs" : "need"} a step from you`,
    );
  return parts.length > 0 ? `${parts.join(", and ")}.` : null;
}

export function wholePictureReply(
  snapshot: Snapshot | null,
  ranked: Ranked[],
  focus: Focus,
): Reply {
  if (!snapshot) {
    return {
      body: "I can't see your money yet. Link a bank or import a CSV, and I'll tell you how you're doing across everything.",
      actions: [{ id: "open", label: "Link a bank", kind: "link", href: "/connect" }],
      refs: {},
    };
  }
  const picture = wholePicture(snapshot, ranked, focus);
  const { top } = picture;
  const numbered = top.map((r, i) => `${i + 1}. ${r.title}. ${r.why}`);
  const thingsHeader =
    top.length === 0
      ? null
      : top.length === 1
        ? "One thing matters most:"
        : `These ${top.length} matter most:`;

  const lines =
    focus === "month"
      ? [
          top.length === 0
            ? "Nothing needs doing this month. I'll tell you here when something does."
            : `This month, ${top.length === 1 ? "one thing matters most" : `${top.length} things matter most`}, starting with ${top[0].title.replace(/[.!?]+$/, "")}.`,
          ...numbered,
          picture.headline,
          dueLine(picture, snapshot.asOf, focus),
          janeLine(picture),
        ]
      : [
          picture.headline,
          dueLine(picture, snapshot.asOf, focus),
          janeLine(picture),
          thingsHeader,
          ...numbered,
        ];

  // The first thing gets its Yes when it's a finding; each gets a link to it.
  const actions: MessageAction[] = [];
  let refs: MessageRefs = {};
  const first = top[0];
  const finding =
    first?.kind === "finding"
      ? snapshot.findings.find((f) => `finding:${f.findingId}` === first.key)
      : undefined;
  if (finding) {
    actions.push({ id: "finding.yes", label: `Yes: ${shortName(finding.title)}`, kind: "primary" });
    refs = { findingId: finding.findingId, fingerprint: finding.fingerprint };
  }
  if (picture.safeItems > 1)
    actions.push({ id: "plan.approve_safe", label: "Approve all safe ones", kind: "secondary" });
  for (const r of top)
    actions.push({ id: "open", label: shortName(r.title), kind: "link", href: r.href });
  if (top.length === 0)
    actions.push({ id: "open", label: "See today", kind: "link", href: "/home" });

  return { body: lines.filter((l): l is string => Boolean(l)).join("\n"), actions, refs };
}
