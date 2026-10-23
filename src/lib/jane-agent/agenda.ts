import {
  AGENDA_MAX_LINES,
  AGENDA_MAX_YES,
  AGENDA_URGENT_PRIORITY,
  CHAT_UNCAPPED_SOURCES,
} from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import type { LocalTime } from "./quiet-hours";
import type { Snapshot } from "./snapshot";
import { billsDueSoon, greeting, safeLine } from "./sources/brief";
import { shortName } from "./sources/findings";
import { suggestionCard } from "./sources/suggestions";
import { lastWeekLine } from "./sources/last-week";
import { inDays } from "./sources/source";
import type { OfferedSuggestion } from "@/lib/suggestions";
import type { ActionId, Candidate, MessageAction } from "./types";

// The day in one message (spec step 184). The morning brief becomes the day's agenda: what
// Jane did overnight (step 142), what needs a yes (a Yes each, and "Approve all safe ones"),
// what's coming up, and anything else worth knowing, a line each. Everything less urgent
// than an urgent alert or a deadline waits for it, so Jane says nothing else until something
// urgent comes up. Each thing the agenda lists is still posted, hidden behind it (like a
// bundle's findings, spec step 92), so it's never said twice and its Yes works on it. Pure.

type Planned = Candidate & { source: string };

// What comes at once, outside the agenda: the agenda itself (and the week's summary), the
// one-time messages (the hello, the autopilot question) and anything urgent.
export const outsideAgenda = (c: Planned) =>
  c.kind === "brief" ||
  CHAT_UNCAPPED_SOURCES.includes(c.source) ||
  c.priority >= AGENDA_URGENT_PRIORITY;

// The message's main button: what Yes means for it. The week's plan is answered by the
// agenda's own "Approve all safe ones".
const yesOf = (c: Candidate): MessageAction | undefined => {
  const yes = c.kind === "decision" ? c.actions.find((a) => a.kind === "primary") : undefined;
  return yes?.id === "plan.approve_safe" ? undefined : yes;
};

// One line for a message: its first line, without the question that asks for the tap.
export function lineOf(c: Candidate): string {
  if (c.bundle) return c.bundle.line;
  const lines = c.body.split("\n");
  // A message that introduces a list ("...ready for your insurance:" and its bullets) is
  // one line with the list's first items, not just the introduction.
  const items = lines
    .slice(1)
    .filter((l) => l.startsWith("- "))
    .slice(0, 2)
    .map((l) =>
      l
        .slice(2)
        .trim()
        .replace(/[.!?]+$/, ""),
    );
  const first =
    lines[0].trim().endsWith(":") && items.length > 0
      ? `${lines[0].trim()} ${items.join("; ")}.`
      : lines[0].trim();
  const sentences = first.split(/(?<=[.!?])\s+/);
  while (sentences.length > 1 && sentences.at(-1)!.endsWith("?")) sentences.pop();
  return sentences.join(" ");
}

// Spec step 265: what Jane worked out for this person leads the day. One suggestion as its
// agenda line: what it is, what it's worth, why this person, and how sure Jane is with the
// reason. The pages are the detail behind it (its button opens them).
export function suggestionLine(s: OfferedSuggestion): string {
  const [headline, why, sure] = suggestionCard(s);
  return `${headline}. ${why} ${sure}`;
}

export type Agenda<T extends Planned> = { agenda: T; folded: T[] };

export function agendaOf<T extends Planned>(
  brief: T,
  held: readonly T[],
  snapshot: Snapshot,
  local: LocalTime,
  now: Date,
): Agenda<T> {
  // Spec step 265: the nightly scan's suggestions come first, then everything else that needs
  // a yes (the order of the scan: its best first).
  const offered = new Map((snapshot.suggestions ?? []).map((s) => [s.key, s]));
  const suggested = (c: Candidate) =>
    c.refs.suggestion ? offered.get(c.refs.suggestion) : undefined;
  const ordered = [...held].sort(
    (a, b) =>
      Number(Boolean(suggested(b))) - Number(Boolean(suggested(a))) || b.priority - a.priority,
  );
  const yes = ordered.filter((c) => yesOf(c)).slice(0, AGENDA_MAX_YES);
  const others = ordered.filter((c) => !yesOf(c)).slice(0, AGENDA_MAX_LINES);
  const lead = yes.filter((c) => suggested(c));
  const rest = yes.filter((c) => !suggested(c));
  const line = (c: Candidate) => {
    const s = suggested(c);
    return s ? suggestionLine(s) : lineOf(c);
  };

  const run = snapshot.lastRun;
  const changed = run?.steps.filter((s) => s.changed > 0) ?? [];
  const overnight = run
    ? changed.length > 0
      ? `Overnight I checked ${run.steps.length} areas: ${changed
          .map((s) => s.did.replace(/\.$/, ""))
          .join("; ")}.`
      : `Overnight I checked ${run.steps.length} areas; nothing needed you.`
    : null;
  const bills = billsDueSoon(snapshot);
  const safe = safeLine(snapshot, local.date);
  // On the first day of the week, how last week went (the weekly review, in the brief).
  const week = lastWeekLine(snapshot, local, now);

  const quiet = yes.length === 0 && others.length === 0 && bills.length === 0;
  const lines: string[] = [];
  if (quiet) {
    // A day with nothing to do: one short line.
    lines.push(`${greeting(local.hour)} Nothing needs you today.${safe ? ` ${safe}` : ""}`);
    if (week) lines.push(week);
  } else {
    lines.push(safe ? `${greeting(local.hour)} ${safe}` : greeting(local.hour));
    if (week) lines.push(week);
    if (overnight) lines.push(overnight);
    if (lead.length > 0) {
      lines.push(
        lead.length === 1
          ? "Here's what I'd do first, from looking at your money:"
          : "Here's what I'd do first, from looking at your money:",
      );
      lines.push(...lead.map((c) => `- ${line(c)}`));
    }
    if (rest.length > 0) {
      lines.push(rest.length === 1 ? "One more thing needs your yes:" : "These need your yes:");
      lines.push(...rest.map((c) => `- ${lineOf(c)}`));
    }
    if (bills.length > 0) {
      lines.push(
        `Coming up: ${bills
          .map(
            (b) =>
              `${b.label}${b.amountCents === null ? "" : ` ${formatCents(b.amountCents)}`} ${inDays(b.daysLeft)}`,
          )
          .join(", ")}.`,
      );
    }
    if (others.length > 0) {
      lines.push("Also:");
      lines.push(...others.map((c) => `- ${lineOf(c)}`));
    }
  }

  const items = yes.map((c) => ({
    dedupeKey: c.dedupeKey,
    label: `Yes: ${c.bundle?.name ?? (suggested(c) ? shortName(suggested(c)!.actionLabel) : shortName(lineOf(c)))}`,
    action: yesOf(c)!.id as ActionId,
    // A suggestion can be turned down for good from the agenda (the scan never offers it again).
    ...(suggested(c) ? { no: "suggestion.no" as ActionId } : {}),
  }));
  const actions: MessageAction[] = [
    ...items.map((item, n): MessageAction => ({
      id: `bundle.${n + 1}` as ActionId,
      label: item.label,
      kind: "primary",
    })),
    ...items.flatMap((item, n): MessageAction[] =>
      item.no
        ? [
            {
              id: `bundle.no.${n + 1}` as ActionId,
              label: `Not for me: ${item.label.replace(/^Yes: /, "")}`,
              kind: "secondary",
            },
          ]
        : [],
    ),
    ...(snapshot.plan.safeItems > 0
      ? [
          {
            id: "plan.approve_safe" as const,
            label: "Approve all safe ones",
            kind: "secondary" as const,
          },
        ]
      : []),
    { id: "open", label: "See today", kind: "link", href: "/home" },
  ];
  return {
    agenda: {
      ...brief,
      body: lines.join("\n"),
      refs: { ...brief.refs, ...(items.length > 0 ? { items } : {}) },
      actions,
    },
    folded: [...yes, ...others],
  };
}
