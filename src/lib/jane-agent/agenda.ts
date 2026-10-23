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
import { lastWeekLine } from "./sources/last-week";
import { inDays } from "./sources/source";
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

// The agenda's one line about the suggestions: they're on the cards, not repeated here.
export function cardsLine(count: number): string {
  return count === 1
    ? "I have a suggestion for you, from looking at your money: it's on the card at the bottom."
    : `I have ${count} suggestions for you, from looking at your money: they're on the cards at the bottom.`;
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
  // The suggestions float over the chat as cards (src/app/chat/chat-cards.tsx), the one place
  // they appear: the agenda only says they're there, and they never take one of its Yes slots.
  const lead = ordered.filter((c) => suggested(c));
  const yes = ordered.filter((c) => yesOf(c) && !suggested(c)).slice(0, AGENDA_MAX_YES);
  const others = ordered.filter((c) => !yesOf(c) && !suggested(c)).slice(0, AGENDA_MAX_LINES);

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

  const quiet = lead.length === 0 && yes.length === 0 && others.length === 0 && bills.length === 0;
  const lines: string[] = [];
  if (quiet) {
    // A day with nothing to do: one short line.
    lines.push(`${greeting(local.hour)} Nothing needs you today.${safe ? ` ${safe}` : ""}`);
    if (week) lines.push(week);
  } else {
    lines.push(safe ? `${greeting(local.hour)} ${safe}` : greeting(local.hour));
    if (week) lines.push(week);
    if (overnight) lines.push(overnight);
    if (lead.length > 0) lines.push(cardsLine(lead.length));
    if (yes.length > 0) {
      lines.push(yes.length === 1 ? "One more thing needs your yes:" : "These need your yes:");
      lines.push(...yes.map((c) => `- ${lineOf(c)}`));
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
    label: `Yes: ${c.bundle?.name ?? shortName(lineOf(c))}`,
    action: yesOf(c)!.id as ActionId,
  }));
  const actions: MessageAction[] = [
    ...items.map((item, n): MessageAction => ({
      id: `bundle.${n + 1}` as ActionId,
      label: item.label,
      kind: "primary",
    })),
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
    // The suggestions too: hidden from the list, they are the cards, and once answered they
    // come back into the history with what was chosen.
    folded: [...lead, ...yes, ...others],
  };
}
