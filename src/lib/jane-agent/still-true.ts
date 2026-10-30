import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { parseKey } from "@/detection/unusual";
import { daysBetween } from "@/detection/units";
import type { Deadline } from "@/insights/deadlines";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { deadlineHeadsUp } from "./sources/heads-ups";
import { suggestionCard } from "./sources/suggestions";
import { MESSAGE_SELECT, toChatMessage, type ChatMessage } from "./types";

// Jane's cards say what was true when they were posted, and stay open for days. Before one
// shows again (the dock, Home, the chat's cards) it is checked against the person's data now
// (card-chat mismatch: after the demo bank was disconnected, the dock still said "Coming up in
// 3 days: Return window for Apple Store ($1,349.00)" while the chat found no such purchase):
// - a deadline heads-up whose deadline is gone (its purchase was in a bank since removed, or
//   was refunded) or has passed is put away; one that still holds is said as of today;
// - an alert about a charge that's no longer in the accounts is put away, and so is a deadline
//   reminder whose deadline is gone;
// - a change Jane noticed ("By now you'd usually have spent about $37.08") is said as Jane
//   sees it today, and put away once it no longer shows (src/lib/changes.ts).
// The deadlines come from loadComingUp, the one loader Today, Ahead, the snapshot behind the
// heads-ups and the chat's coming_up all read, so the dock can't say what they don't.

type Options = { client?: PrismaClient; now?: Date };

type SuggestionRow = {
  key: string;
  headline: string;
  short: string;
  why: string;
  confidencePercent: number;
  confidenceReason: string;
};

type Facts = {
  asOf: string;
  deadlines: Map<string, Deadline>;
  // Alerts, by id: whether each still holds.
  alerts: Map<string, boolean>;
  // The changes Jane sees today, by key: each one's title.
  changes: Map<string, string> | null;
  // The suggestions behind suggestion cards, by key, as the last scan left them.
  suggestions: Map<string, SuggestionRow>;
};

type AlertRow = { id: string; type: string; key: string };

const needsDeadlines = (m: ChatMessage, deadlineAlerts: ReadonlySet<string>) =>
  m.refs.deadlineKey !== undefined ||
  (m.refs.alertId !== undefined && deadlineAlerts.has(m.refs.alertId));

// Loaded here, not imported at the top: the deadlines reach most of the app.
const comingUp = (userId: string, client: PrismaClient, now: Date) =>
  import("@/lib/coming-up").then((m) => m.loadComingUp(userId, { client, now, days: 0 }));

// Whether each alert still holds: one about a charge (src/detection/unusual.ts keyOf names its
// transaction) while the charge is in the accounts, a deadline reminder while its deadline is.
async function holding(
  userId: string,
  alerts: readonly AlertRow[],
  deadlines: ReadonlyMap<string, Deadline>,
  client: PrismaClient,
): Promise<Map<string, boolean>> {
  const charged = alerts.flatMap((a) => {
    const parsed = a.type === "unusual_activity" ? parseKey(a.key) : null;
    return parsed ? [parsed.transactionId] : [];
  });
  const present = new Set(
    charged.length
      ? (
          await scopedFor(userId, client).transactions.findMany({
            where: { id: { in: charged } },
            select: { id: true },
          })
        ).map((t) => t.id)
      : [],
  );
  return new Map(
    alerts.map((a) => {
      if (a.type === "deadline_soon") return [a.id, deadlines.has(a.key)];
      const parsed = a.type === "unusual_activity" ? parseKey(a.key) : null;
      return [a.id, !parsed || present.has(parsed.transactionId)];
    }),
  );
}

// The alerts that still hold, for the chat's alerts lookup: it says what the dock does.
export async function alertsThatHold<T extends AlertRow>(
  userId: string,
  alerts: readonly T[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<T[]> {
  const deadlines = alerts.some((a) => a.type === "deadline_soon")
    ? new Map((await comingUp(userId, client, now)).deadlines.map((d) => [d.key, d]))
    : new Map<string, Deadline>();
  const held = await holding(userId, alerts, deadlines, client);
  return alerts.filter((a) => held.get(a.id) !== false);
}

async function factsFor(
  userId: string,
  messages: readonly ChatMessage[],
  client: PrismaClient,
  now: Date,
): Promise<Facts | null> {
  const alertIds = messages.flatMap((m) => (m.refs.alertId ? [m.refs.alertId] : []));
  const alerts = alertIds.length
    ? await scopedFor(userId, client).alerts.findMany({
        where: { id: { in: alertIds } },
        select: { id: true, type: true, key: true },
      })
    : [];
  const deadlineAlerts = new Set(alerts.filter((a) => a.type === "deadline_soon").map((a) => a.id));
  const withDeadlines = messages.some((m) => needsDeadlines(m, deadlineAlerts));
  const withChanges = messages.some((m) => m.refs.change !== undefined);
  const suggestionKeys = messages.flatMap((m) => (m.refs.suggestion ? [m.refs.suggestion] : []));
  if (!withDeadlines && !withChanges && alerts.length === 0 && suggestionKeys.length === 0) {
    return null;
  }
  const [coming, changes, suggestions] = await Promise.all([
    withDeadlines ? comingUp(userId, client, now) : null,
    withChanges
      ? import("@/lib/changes").then((m) => m.loadChanges(userId, { client, now }))
      : null,
    suggestionKeys.length > 0
      ? scopedFor(userId, client).suggestions.findMany({
          where: { key: { in: suggestionKeys } },
          select: {
            key: true,
            headline: true,
            short: true,
            why: true,
            confidencePercent: true,
            confidenceReason: true,
          },
        })
      : [],
  ]);
  const deadlines = new Map((coming?.deadlines ?? []).map((d) => [d.key, d]));
  return {
    asOf: coming?.asOf ?? now.toISOString().slice(0, 10),
    deadlines,
    alerts: await holding(userId, alerts, deadlines, client),
    changes: changes && new Map(changes.map((c) => [c.key, c.title])),
    suggestions: new Map(suggestions.map((r) => [r.key, r])),
  };
}

// The card as it should show now, or null when it no longer holds.
function asNow(m: ChatMessage, facts: Facts): ChatMessage | null {
  const { deadlineKey, deadlineEntryId, alertId, change, suggestion } = m.refs;
  // A suggestion card is said as the last scan left its suggestion: after a bank was
  // disconnected, "You keep $47,597.63 in cash" stayed while the scan said $19,447.51 (night
  // debugger, 10-30). One with no row (a news theme's alert) is checked elsewhere.
  const row = suggestion ? facts.suggestions.get(suggestion) : undefined;
  if (row) {
    const [, , , ...rest] = m.body.split("\n");
    return {
      ...m,
      body: [...suggestionCard(row), ...rest].join("\n"),
      refs: { ...m.refs, suggestionWhy: row.why },
    };
  }
  // An alert that no longer holds, or is gone altogether (removed with the data it was about:
  // src/lib/evidence/orphans.ts), takes its heads-up with it.
  if (alertId !== undefined && facts.alerts.get(alertId) !== true) return null;
  if (change && facts.changes) {
    const title = facts.changes.get(change.key);
    if (title === undefined) return null;
    if (m.body.includes(title)) return m;
    // Said as of today; a card from before titles were kept can't be, so it goes.
    return change.title && m.body.includes(change.title)
      ? { ...m, body: m.body.replace(change.title, title) }
      : null;
  }
  if (deadlineKey === undefined) return m;
  const deadline = facts.deadlines.get(deadlineKey);
  // One the person typed in is settled by its own row (./settled.ts); the list may leave out a
  // passed one.
  if (!deadline) return deadlineEntryId ? m : null;
  if (daysBetween(facts.asOf, deadline.date) < 0 && !deadlineEntryId) return null;
  return { ...m, body: deadlineHeadsUp(deadline, facts.asOf) };
}

// Puts away the ones that no longer hold (their links stay, like a card answered elsewhere).
async function putAway(
  userId: string,
  gone: readonly ChatMessage[],
  client: PrismaClient,
  now: Date,
) {
  let count = 0;
  for (const m of gone) {
    const result = await scopedFor(userId, client).janeMessages.updateMany({
      where: { id: m.id, status: "open" },
      data: {
        status: "answered",
        answeredAt: now,
        actions: m.actions.filter((a) => a.kind === "link") as Prisma.InputJsonArray,
      },
    });
    count += result.count;
  }
  return count;
}

// The cards that still hold, each said as of today; the rest are put away.
export async function stillTrue(
  userId: string,
  messages: readonly ChatMessage[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ChatMessage[]> {
  const facts = await factsFor(userId, messages, client, now);
  if (!facts) return [...messages];
  const kept: ChatMessage[] = [];
  const gone: ChatMessage[] = [];
  for (const m of messages) {
    const shown = asNow(m, facts);
    if (shown) kept.push(shown);
    else gone.push(m);
  }
  if (gone.length > 0) await putAway(userId, gone, client, now);
  return kept;
}

// Every open heads-up that no longer holds, put away: when the chat opens and Jane's daily run
// (closeSettled), so the chat's own list agrees with the dock. How many.
export async function putAwayUntrue(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const open = (
    await scopedFor(userId, client).janeMessages.findMany({
      where: { status: "open", kind: "heads_up" },
      select: MESSAGE_SELECT,
    })
  ).map(toChatMessage);
  const facts = await factsFor(userId, open, client, now);
  if (!facts) return 0;
  return putAway(
    userId,
    open.filter((m) => !asNow(m, facts)),
    client,
    now,
  );
}
