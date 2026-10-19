import {
  CHAT_DAILY_LIMIT,
  CHAT_SOURCE_LIMITS,
  CHAT_UNCAPPED_SOURCES,
  QUIET_END_HOUR,
  QUIET_START_HOUR,
} from "@/config/agent-chat";
import { inQuietHours, localTime } from "./quiet-hours";
import type { Snapshot } from "./snapshot";
import { MESSAGE_SOURCES, type MessageSource, type Trigger } from "./sources";
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

export type BrainSettings = {
  trigger: Trigger;
  dailyLimit?: number;
  sourceLimits?: Readonly<Record<string, number>>;
  quietHours?: { start: number; end: number };
  sources?: readonly MessageSource[];
};

// What Jane already said: the recent messages (to count today's) and which of today's
// candidates were ever posted.
export type History = {
  recent: readonly { kind: string; dedupeKey: string; createdAt: Date }[];
  seenKeys: readonly string[];
  // Spec step 83: messages the person said "Not now" to, and until when. Never posted again
  // before then; after, Jane may bring them up again (if they still apply).
  snoozed?: readonly { dedupeKey: string; until: Date }[];
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
  const fresh = candidates.filter(
    (c) =>
      !seen.has(c.dedupeKey) &&
      !never.has(`message:${c.dedupeKey}`) &&
      !stopped.has(c.source) &&
      !holds(snapshot.attention, c.source, clock),
  );
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
