import {
  CHAT_DAILY_LIMIT,
  CHAT_SOURCE_LIMITS,
  CHAT_SOURCE_MONTHLY_LIMITS,
  CHAT_UNCAPPED_SOURCES,
  QUIET_END_HOUR,
  QUIET_START_HOUR,
} from "@/config/agent-chat";
import { inQuietHours, localTime } from "./quiet-hours";
import type { Snapshot } from "./snapshot";
import { MESSAGE_SOURCES, type MessageSource, type Trigger } from "./sources";
import { agendaOf, outsideAgenda } from "./agenda";
import { bundleGroups, bundleOf } from "./bundle";
import { holds } from "./attention";
import type { Candidate, MessageKind } from "./types";

// Jane's daily brain (spec step 82): decides what to say. Pure: the snapshot of the
// person's money, what Jane already said, the time and the settings in; the messages to
// post out, most important first. The runner (./run.ts) loads and writes.
//
// The rules: nothing during quiet hours (9pm–8am in the person's timezone) unless they
// opened the chat themselves; never the same thing twice (dedupeKey); at most
// CHAT_DAILY_LIMIT messages a day besides the brief, and at most each source's own limit.
// Spec step 184: with settings.agenda, the day is one agenda message plus whatever is
// urgent (./agenda.ts), and the limits don't apply.

export type BrainSettings = {
  trigger: Trigger;
  dailyLimit?: number;
  sourceLimits?: Readonly<Record<string, number>>;
  quietHours?: { start: number; end: number };
  sources?: readonly MessageSource[];
  // Spec step 184: the day as one agenda message (./agenda.ts) plus whatever is urgent.
  // Jane's runner turns it on; off, each thing is its own message within the limits.
  agenda?: boolean;
};

// What Jane already said: the recent messages (to count today's) and which of today's
// candidates were ever posted.
export type History = {
  recent: readonly { kind: string; dedupeKey: string; createdAt: Date }[];
  seenKeys: readonly string[];
  // Spec step 83: messages the person said "Not now" to, and until when. Never posted again
  // before then; after, Jane may bring them up again (if they still apply).
  snoozed?: readonly { dedupeKey: string; until: Date }[];
  // Spec step 273: how many messages each monthly-limited source (CHAT_SOURCE_MONTHLY_LIMITS)
  // posted this calendar month. Absent: not counted, so not limited.
  thisMonth?: Readonly<Record<string, number>>;
};

// hidden (spec step 92): stands behind a bundle; posted so it's never posted again on its
// own, but not shown.
export type PlannedMessage = Candidate & { source: string; hidden?: boolean };

// Jane's own messages count toward the day; what the person typed and Jane's answers to it
// (step 84) don't.
const COUNTED: readonly MessageKind[] = ["decision", "done", "heads_up"];

// Every candidate from every source, each dedupeKey prefixed with its source's key.
export function gather(snapshot: Snapshot, now: Date, settings: BrainSettings): PlannedMessage[] {
  const context = {
    now,
    local: localTime(now, snapshot.timezone),
    trigger: settings.trigger,
  };
  return (settings.sources ?? MESSAGE_SOURCES).flatMap((source) =>
    source
      .gather(snapshot, context)
      .map((c) => ({ ...c, source: source.key, dedupeKey: `${source.key}:${c.dedupeKey}` })),
  );
}

const sourceOf = (dedupeKey: string) => dedupeKey.slice(0, dedupeKey.indexOf(":"));

// Spec step 83: the brief and the one-time autopilot question are outside the daily limits.
const uncapped = (m: { kind: string; source: string }) =>
  m.kind === "brief" || CHAT_UNCAPPED_SOURCES.includes(m.source);

export function plan(
  snapshot: Snapshot,
  history: History,
  now: Date,
  settings: BrainSettings,
): PlannedMessage[] {
  const timezone = snapshot.timezone;
  const quiet = settings.quietHours ?? { start: QUIET_START_HOUR, end: QUIET_END_HOUR };
  if (settings.trigger !== "open" && inQuietHours(now, timezone, quiet)) return [];

  const today = localTime(now, timezone).date;
  const postedToday = history.recent.filter(
    (m) =>
      COUNTED.includes(m.kind as MessageKind) &&
      !CHAT_UNCAPPED_SOURCES.includes(sourceOf(m.dedupeKey)) &&
      localTime(m.createdAt, timezone).date === today,
  );
  const perSource = new Map<string, number>();
  for (const m of postedToday) {
    perSource.set(sourceOf(m.dedupeKey), (perSource.get(sourceOf(m.dedupeKey)) ?? 0) + 1);
  }
  const limits = settings.sourceLimits ?? CHAT_SOURCE_LIMITS;
  let left = (settings.dailyLimit ?? CHAT_DAILY_LIMIT) - postedToday.length;

  // A snooze that's over lets its message come back (spec step 83).
  const snoozeOver = new Set(
    (history.snoozed ?? []).filter((s) => s.until <= now).map((s) => s.dedupeKey),
  );
  const seen = new Set(
    [...history.seenKeys, ...history.recent.map((m) => m.dedupeKey)].filter(
      (key) => !snoozeOver.has(key),
    ),
  );
  // Most important first; a stable sort keeps each source's own order within a priority.
  const candidates = gather(snapshot, now, settings)
    .map((c, index) => ({ c, index }))
    .sort((a, b) => b.c.priority - a.c.priority || a.index - b.index)
    .map(({ c }) => c);

  // Spec step 91: never what the person said not to suggest again.
  const never = new Set(snapshot.neverSuggest ?? []);
  // Spec step 147: never a kind the person never acts on, and what isn't urgent waits for
  // the hour they usually answer (never more than a day).
  const stopped = new Set((snapshot.attention?.stopped ?? []).map((s) => s.source));
  const clock = { now, timezone, trigger: settings.trigger };
  // Spec step 273: a monthly-limited source (taxes) says at most its limit a month, the most
  // important first, unless a message is urgent.
  const monthLeft = new Map(
    Object.entries(CHAT_SOURCE_MONTHLY_LIMITS).map(([source, l]) => [
      source,
      history.thisMonth ? l.limit - (history.thisMonth[source] ?? 0) : Number.POSITIVE_INFINITY,
    ]),
  );
  const withinMonth = (c: PlannedMessage) => {
    const l = CHAT_SOURCE_MONTHLY_LIMITS[c.source];
    if (!l || c.priority >= l.urgentFrom) return true;
    const refs = c.refs as Record<string, unknown>;
    if (l.questionRefs.some((key) => refs[key] !== undefined)) return true;
    const left = monthLeft.get(c.source) ?? 0;
    if (left <= 0) return false;
    monthLeft.set(c.source, left - 1);
    return true;
  };
  const fresh = candidates.filter(
    (c) =>
      !seen.has(c.dedupeKey) &&
      !never.has(`message:${c.dedupeKey}`) &&
      !stopped.has(c.source) &&
      !holds(snapshot.attention, c.source, clock) &&
      withinMonth(c),
  );
  // Spec step 184: the brief is the day's agenda. Everything less urgent waits for it and
  // goes in as a line, posted hidden behind it; until the next agenda, only urgent things
  // come.
  if (settings.agenda) {
    const now_ = fresh.filter(outsideAgenda);
    const held = fresh.filter((c) => !outsideAgenda(c));
    const at = now_.findIndex((c) => c.source === "brief" && c.kind === "brief");
    const out: PlannedMessage[] = [];
    for (const [index, candidate] of now_.entries()) {
      if (index === at) {
        const { agenda, folded } = agendaOf(
          candidate,
          held,
          snapshot,
          localTime(now, timezone),
          now,
        );
        out.push(agenda, ...folded.map((f) => ({ ...f, hidden: true })));
      } else {
        out.push(candidate);
      }
    }
    return out;
  }

  // Spec step 92: findings of one kind become one message, in the first one's place.
  const behind = new Map<string, PlannedMessage[]>();
  for (const group of bundleGroups(fresh)) {
    const bundle = bundleOf(group);
    const at = fresh.indexOf(group[0]);
    for (const item of group) fresh.splice(fresh.indexOf(item), 1);
    fresh.splice(at, 0, bundle);
    behind.set(bundle.dedupeKey, group);
  }
  const out: PlannedMessage[] = [];
  for (const candidate of fresh) {
    if (seen.has(candidate.dedupeKey)) continue;
    if (never.has(`message:${candidate.dedupeKey}`)) continue;
    if (uncapped(candidate)) {
      seen.add(candidate.dedupeKey);
      out.push(candidate);
      continue;
    }
    const used = perSource.get(candidate.source) ?? 0;
    if (left <= 0 || used >= (limits[candidate.source] ?? Number.POSITIVE_INFINITY)) continue;
    seen.add(candidate.dedupeKey);
    perSource.set(candidate.source, used + 1);
    left -= 1;
    out.push(candidate);
    // A bundle's own findings, posted hidden behind it.
    for (const item of behind.get(candidate.dedupeKey) ?? []) {
      seen.add(item.dedupeKey);
      out.push({ ...item, hidden: true });
    }
  }
  return out;
}
