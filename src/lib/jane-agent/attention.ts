import {
  ATTENTION_ALWAYS,
  ATTENTION_GRACE_HOURS,
  ATTENTION_HOLD_MAX_HOURS,
  ATTENTION_LABELS,
  ATTENTION_MIN_ANSWERS,
  ATTENTION_MIN_NOTIFIED,
  ATTENTION_STOP_AFTER,
  ATTENTION_WINDOW_HOURS,
} from "@/config/attention";
import { localTime } from "./quiet-hours";
import type { Trigger } from "./sources/source";
import { parseActions } from "./types";

// Asking less, at the right time (spec step 147). Pure: from Jane's own messages of the last
// couple of months and what the person did with them, the hour they usually answer, the
// channel (phone or email) that gets answers, and the kinds of message they never say yes
// to. Jane's brain holds what isn't urgent for that hour (never longer than a day) and
// stops a kind nobody acts on, saying so; Settings shows it and brings it back. Urgent
// alerts, deadlines and bills (ATTENTION_ALWAYS) are never held or stopped.

export type AttentionMessage = {
  dedupeKey: string;
  kind: string;
  actions: unknown;
  status: string;
  answeredWith: string | null;
  answeredAt: Date | null;
  createdAt: Date;
  notifiedVia: string | null;
};

export type StoppedKind = {
  source: string;
  label: string;
  // How many in a row went without a yes, and the day of the newest.
  asked: number;
  lastOn: string;
};

export type Attention = {
  usualHour: number | null;
  channel: "push" | "email" | null;
  stopped: StoppedKind[];
  lastPostedAt: Date | null;
};

const JANES: readonly string[] = ["decision", "done", "heads_up"];
const HOUR_MS = 60 * 60 * 1000;

export const sourceOf = (dedupeKey: string) => dedupeKey.slice(0, dedupeKey.indexOf(":"));
export const labelOf = (source: string) => ATTENTION_LABELS[source] ?? `${source} messages`;
export const alwaysSaid = (source: string) => ATTENTION_ALWAYS.includes(source);

const primaryLabels = (actions: unknown) =>
  parseActions(actions)
    .filter((a) => a.kind === "primary")
    .map((a) => a.label);

// Said yes: answered with one of the message's primary buttons.
export const actedOn = (m: AttentionMessage) =>
  m.status === "answered" &&
  m.answeredWith !== null &&
  primaryLabels(m.actions).includes(m.answeredWith);

function usualHour(messages: AttentionMessage[], timezone: string | null): number | null {
  const answers = messages.filter((m) => m.answeredAt && JANES.includes(m.kind));
  if (answers.length < ATTENTION_MIN_ANSWERS) return null;
  const counts = new Map<number, number>();
  for (const m of answers) {
    const hour = localTime(m.answeredAt!, timezone).hour;
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function channel(messages: AttentionMessage[]): Attention["channel"] {
  const rate = (via: string) => {
    const sent = messages.filter((m) => m.notifiedVia === via || m.notifiedVia === "both");
    return sent.length < ATTENTION_MIN_NOTIFIED
      ? null
      : sent.filter((m) => m.answeredAt).length / sent.length;
  };
  const push = rate("push");
  const email = rate("email");
  if (push === null || email === null || push === email) return null;
  return push > email ? "push" : "email";
}

function stopped(
  messages: AttentionMessage[],
  now: Date,
  resumed: Readonly<Record<string, Date>>,
): StoppedKind[] {
  const old = now.getTime() - ATTENTION_GRACE_HOURS * HOUR_MS;
  const bySource = new Map<string, AttentionMessage[]>();
  for (const m of messages) {
    const source = sourceOf(m.dedupeKey);
    if (alwaysSaid(source) || !JANES.includes(m.kind)) continue;
    if (primaryLabels(m.actions).length === 0) continue;
    if (m.createdAt.getTime() > old && !actedOn(m)) continue;
    if (resumed[source] && m.createdAt <= resumed[source]) continue;
    bySource.set(source, [...(bySource.get(source) ?? []), m]);
  }
  return [...bySource].flatMap(([source, rows]) => {
    const newest = [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, ATTENTION_STOP_AFTER);
    if (newest.length < ATTENTION_STOP_AFTER || newest.some(actedOn)) return [];
    return [
      {
        source,
        label: labelOf(source),
        asked: newest.length,
        lastOn: newest[0].createdAt.toISOString().slice(0, 10),
      },
    ];
  });
}

export function learnAttention(
  messages: AttentionMessage[],
  {
    timezone,
    now,
    resumed = {},
  }: { timezone: string | null; now: Date; resumed?: Readonly<Record<string, Date>> },
): Attention {
  const janes = messages.filter((m) => JANES.includes(m.kind));
  const last = janes.reduce<Date | null>(
    (latest, m) => (!latest || m.createdAt > latest ? m.createdAt : latest),
    null,
  );
  return {
    usualHour: usualHour(messages, timezone),
    channel: channel(janes),
    stopped: stopped(messages, now, resumed),
    lastPostedAt: last,
  };
}

// Hours apart on a clock face: 23 and 1 are 2 apart.
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));

// Whether a message from this source waits for the person's usual hour. Never when they
// opened the chat themselves, never for what's urgent, and never once Jane has been quiet
// for a day.
export function holds(
  attention: Attention | undefined,
  source: string,
  { now, timezone, trigger }: { now: Date; timezone: string | null; trigger: Trigger },
): boolean {
  if (!attention || attention.usualHour === null) return false;
  if (trigger === "open" || alwaysSaid(source)) return false;
  if (
    !attention.lastPostedAt ||
    now.getTime() - attention.lastPostedAt.getTime() >= ATTENTION_HOLD_MAX_HOURS * HOUR_MS
  ) {
    return false;
  }
  return apart(localTime(now, timezone).hour, attention.usualHour) > ATTENTION_WINDOW_HOURS;
}

// "around 7pm".
export function hourWords(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `around ${h}${hour < 12 ? "am" : "pm"}`;
}
