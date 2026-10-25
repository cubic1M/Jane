import { SUGGESTIONS_PER_DAY } from "@/config/suggestions";
import { randomUUID } from "node:crypto";
import { CHAT_PAGE_SIZE, MORNING_BRIEF } from "@/config/agent-chat";
import type {
  DecisionChoice,
  DecisionSource,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { PlannedMessage } from "./brain";
import { localTime } from "./quiet-hours";
import { closeAnsweredElsewhere } from "./settled";
import {
  MESSAGE_SELECT,
  parseActions,
  parseRefs,
  toChatMessage,
  type ChatMessage,
  type MessageAction,
  type MessageRefs,
} from "./types";

// Reading and writing Jane's chat messages (spec step 81), always for one person.

type Options = { client?: PrismaClient; now?: Date };

// Jane's own messages, as opposed to what the person typed (step 84). Her answers to it
// ("reply") don't count either: typing before the day's first visit still gets a brief.
const JANE_KINDS = ["brief", "decision", "done", "heads_up"];

// The newest messages, oldest first (the newest at the bottom of the chat). `pages` is how
// many pages of CHAT_PAGE_SIZE to show ("Show earlier" adds one).
export async function chatFeed(
  userId: string,
  {
    client = defaultClient,
    pages = 1,
    now = new Date(),
  }: { client?: PrismaClient; pages?: number; now?: Date } = {},
): Promise<{ messages: ChatMessage[]; hasEarlier: boolean }> {
  const take = CHAT_PAGE_SIZE * Math.max(1, pages);
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    // Spec step 83: a message the person said "Not now" to stays hidden until then.
    where: { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    select: MESSAGE_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });
  return {
    messages: rows.slice(0, take).reverse().map(toChatMessage),
    hasEarlier: rows.length > take,
  };
}

// Whether Jane has posted anything yet today, in the person's own day.
export async function postedToday(
  userId: string,
  timezone: string | null,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const last = await scopedFor(userId, client).janeMessages.findFirst({
    where: { kind: { in: JANE_KINDS } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return (
    last !== null && localTime(last.createdAt, timezone).date === localTime(now, timezone).date
  );
}

// Spec step 92: a finding behind a bundle is hidden for good (until this), and read: it's
// never shown or sent on its own, only through the bundle's buttons.
export const BUNDLED_UNTIL = new Date("9999-12-31T00:00:00Z");

// Writes the brain's messages in its order, a millisecond apart so the chat keeps that
// order. One that was posted meanwhile (the same dedupeKey) is skipped, never doubled.
export async function postMessages(
  userId: string,
  planned: PlannedMessage[],
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  if (planned.length === 0) return 0;
  const created = await scopedFor(userId, client).janeMessages.createManyAndReturn({
    data: planned.map((m, index) => ({
      userId,
      kind: m.kind,
      body: m.body,
      refs: m.refs as Prisma.InputJsonObject,
      actions: m.actions as Prisma.InputJsonArray,
      dedupeKey: m.dedupeKey,
      priority: m.priority,
      createdAt: new Date(now.getTime() + index),
      ...(m.hidden ? { snoozedUntil: BUNDLED_UNTIL, readAt: now } : {}),
    })),
    skipDuplicates: true,
    select: { kind: true, dedupeKey: true, snoozedUntil: true },
  });
  // Spec step 83: one the person said "Not now" to, whose snooze is over, comes back at the
  // bottom of the chat as it is now, buttons and all (the brain only plans it then).
  const createdKeys = new Set(created.map((m) => m.dedupeKey));
  for (const [index, m] of planned.entries()) {
    if (createdKeys.has(m.dedupeKey)) continue;
    const { count } = await scopedFor(userId, client).janeMessages.updateMany({
      where: { dedupeKey: m.dedupeKey, snoozedUntil: { lte: now } },
      data: {
        kind: m.kind,
        body: m.body,
        refs: m.refs as Prisma.InputJsonObject,
        actions: m.actions as Prisma.InputJsonArray,
        priority: m.priority,
        status: "open",
        answeredWith: null,
        answeredAt: null,
        readAt: null,
        snoozedUntil: null,
        createdAt: new Date(now.getTime() + index),
        // Back as new, so it can go out as a notification again (spec step 85).
        notifiedAt: null,
        notifiedVia: null,
      },
    });
    if (count > 0) created.push({ kind: m.kind, dedupeKey: m.dedupeKey, snoozedUntil: null });
  }
  // What the person sees: not the findings hidden behind a bundle.
  const shown = created.filter((m) => m.snoozedUntil?.getTime() !== BUNDLED_UNTIL.getTime());
  for (const message of shown) {
    await track(userId, "chat_message_posted", {
      kind: message.kind,
      source: message.dedupeKey.split(":")[0],
    });
  }
  return shown.length;
}

// Open finding messages whose finding was answered some other way (on its card, the plan,
// a rule, "Approve all safe ones") lose their buttons. So do Jane's answers that offered a
// finding's Yes and No (spec step 84).
export async function closeSettled(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  // Spec step 83: and the rest of Jane's questions answered on their own pages.
  const elsewhere =
    (await closeAnsweredElsewhere(userId, { client, now })) +
    (await settleBundles(userId, { client, now }));
  const open = await db.janeMessages.findMany({
    where: { status: "open", kind: { in: ["decision", "reply"] } },
    select: { id: true, refs: true, actions: true },
  });
  const byFinding = open.flatMap((m) => {
    const refs = parseRefs(m.refs);
    return refs.findingId
      ? [{ id: m.id, findingId: refs.findingId, refs, actions: parseActions(m.actions) }]
      : [];
  });
  if (byFinding.length === 0) return elsewhere;
  const stillOpen = new Set(
    (
      await db.findings.findMany({
        where: {
          id: { in: byFinding.map((m) => m.findingId) },
          status: { in: ["new", "shown"] },
        },
        select: { id: true },
      })
    ).map((f) => f.id),
  );
  const settled = byFinding.filter((m) => !stillOpen.has(m.findingId));
  if (settled.length === 0) return elsewhere;
  // Spec step 86: the answer given on the page (or the plan, a rule…) shows in the chat too.
  const decisions = await db.decisions.findMany({
    where: { findingId: { in: settled.map((m) => m.findingId) }, undoneAt: null },
    orderBy: { createdAt: "desc" },
    select: { findingId: true, choice: true, source: true },
  });
  const answerFor = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) if (!answerFor.has(d.findingId)) answerFor.set(d.findingId, d);
  let closed = elsewhere;
  for (const message of settled) {
    const answer = answerFor.get(message.findingId);
    // Its Open link stays.
    const { count } = await db.janeMessages.updateMany({
      where: { id: message.id, status: "open" },
      data: {
        status: "answered",
        answeredAt: now,
        actions: message.actions.filter((a) => a.kind === "link") as Prisma.InputJsonArray,
        ...(answer
          ? {
              answeredWith: CHOICE_WORDS[answer.choice],
              refs: {
                ...message.refs,
                note: answeredWhere(answer.source),
              } as Prisma.InputJsonObject,
            }
          : {}),
      },
    });
    closed += count;
  }
  return closed;
}

// Spec step 92: a bundle loses the Yes of each finding answered some other way (its own
// row is closed like any finding's), and is answered once none are left.
async function settleBundles(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<number> {
  const db = scopedFor(userId, client);
  const bundles = (
    await db.janeMessages.findMany({
      where: { status: "open", kind: "decision", dedupeKey: { contains: ":bundle:" } },
      select: { id: true, refs: true, actions: true },
    })
  ).map((m) => ({ id: m.id, refs: parseRefs(m.refs), actions: parseActions(m.actions) }));
  const keys = bundles.flatMap((b) => (b.refs.items ?? []).map((i) => i.dedupeKey));
  if (keys.length === 0) return 0;
  const stillOpen = new Set(
    (
      await db.janeMessages.findMany({
        where: { dedupeKey: { in: keys }, status: "open" },
        select: { dedupeKey: true },
      })
    ).map((r) => r.dedupeKey),
  );
  let closed = 0;
  for (const bundle of bundles) {
    const items = bundle.refs.items ?? [];
    const keep = bundle.actions.filter((a) => {
      const n = /^bundle\.(\d)$/.exec(a.id)?.[1];
      return !n || stillOpen.has(items[Number(n) - 1]?.dedupeKey ?? "");
    });
    if (keep.length === bundle.actions.length) continue;
    const done = !keep.some((a) => a.kind !== "link");
    const { count } = await db.janeMessages.updateMany({
      where: { id: bundle.id, status: "open" },
      data: {
        actions: keep as Prisma.InputJsonArray,
        ...(done ? { status: "answered", answeredAt: now, answeredWith: "All answered" } : {}),
      },
    });
    closed += done ? count : 0;
  }
  return closed;
}

// Spec step 86: how an answer given elsewhere reads in the chat.
export const CHOICE_WORDS: Record<DecisionChoice, string> = {
  yes: "Yes",
  no: "No",
  diy: "I'll do it myself",
};

export function answeredWhere(source: DecisionSource): string {
  switch (source) {
    case "card":
      return "You answered this on its page.";
    case "plan":
      return "You answered this on your plan.";
    case "rule":
      return "Your standing rule answered this.";
    case "link":
      return "You answered this from a one-tap link.";
    case "auto":
      return "I answered this as part of something you'd already said yes to.";
    case "chat":
      return "You answered this in another message here.";
  }
}

// Seeing the chat marks Jane's messages read.
export async function markChatRead(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).janeMessages.updateMany({
    where: { readAt: null },
    data: { readAt: now },
  });
}

// Spec step 86: Jane's latest message about a finding, for its card to link back to.
export async function messageAboutFinding(
  userId: string,
  findingId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string | null> {
  const message = await scopedFor(userId, client).janeMessages.findFirst({
    where: {
      kind: { in: ["decision", "reply"] },
      refs: { path: ["findingId"], equals: findingId },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return message?.id ?? null;
}

// Spec step 88: one of Jane's answers, stored under the message it answers (a typed
// question, or a clarifying question's button). Read already: the person is looking.
export async function storeReply(
  userId: string,
  reply: { body: string; actions: MessageAction[]; refs: MessageRefs },
  { client = defaultClient, at }: { client?: PrismaClient; at: Date },
): Promise<ChatMessage> {
  const row = await scopedFor(userId, client).janeMessages.create({
    data: {
      userId,
      kind: "reply",
      body: reply.body,
      refs: reply.refs as Prisma.InputJsonObject,
      actions: reply.actions as Prisma.InputJsonArray,
      dedupeKey: `reply:${randomUUID()}`,
      createdAt: at,
      readAt: at,
    },
    select: MESSAGE_SELECT,
  });
  return toChatMessage(row);
}

// Spec step 96: pin a message (or unpin it), the person's own only. False when it isn't
// theirs.
export async function setPinned(
  userId: string,
  messageId: string,
  pinned: boolean,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const row = await db.janeMessages.findFirst({ where: { id: messageId }, select: { refs: true } });
  if (!row) return false;
  const refs = { ...parseRefs(row.refs) };
  if (pinned) refs.pinned = true;
  else delete refs.pinned;
  await db.janeMessages.updateMany({
    where: { id: messageId },
    data: { refs: refs as Prisma.InputJsonObject },
  });
  return true;
}

// Spec step 96: the person's pinned messages, newest first.
export async function pinnedMessages(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<ChatMessage[]> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: { refs: { path: ["pinned"], equals: true } },
    orderBy: { createdAt: "desc" },
    select: MESSAGE_SELECT,
    take: CHAT_PAGE_SIZE,
  });
  return rows.map(toChatMessage);
}

// The suggestions still waiting for an answer, for the card stack over the chat: the open
// messages of the day's offered suggestions, the agenda's hidden ones too, newest first, at
// most SUGGESTIONS_PER_DAY, from the last day and a half.
export async function stackedSuggestions(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<ChatMessage[]> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: {
      status: "open",
      refs: { path: ["suggestion"], string_contains: ":" },
      createdAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000), lte: now },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: MESSAGE_SELECT,
    take: SUGGESTIONS_PER_DAY,
  });
  // In the order the day's best came in: the first card is the best.
  return rows.reverse().map(toChatMessage);
}

// Jane's own open messages that wait on the person (something to decide, a heads-up with a
// button), for the pop-ups (src/lib/jane-agent/popups.ts): newest first, at most POPUP_LIMIT,
// from the last POPUP_DAYS. The day's suggestions are stackedSuggestions' (the caller leaves
// them out: a JSON path filter here would drop every message without the field).
export const POPUP_LIMIT = 12;
export const POPUP_DAYS = 14;

export async function openPopupMessages(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<ChatMessage[]> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: {
      status: "open",
      kind: { in: ["decision", "heads_up", "brief", "done"] },
      createdAt: { gte: new Date(now.getTime() - POPUP_DAYS * 24 * 60 * 60 * 1000), lte: now },
      // Put off or put away (snoozed), it waits out of sight, as in the chat's feed; with the
      // brief off, what an old agenda bundled behind itself comes up on its own.
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lte: now } },
        ...(MORNING_BRIEF ? [] : [{ snoozedUntil: BUNDLED_UNTIL }]),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: MESSAGE_SELECT,
    take: POPUP_LIMIT * 3,
  });
  // An answer to what the person typed (a finding with Yes and No after "cancel hulu") stays in
  // the conversation: Jane's first message after each thing they typed, within the window.
  // Anything else she posts meanwhile (the scan finishing) is hers, and floats.
  const since = new Date(now.getTime() - POPUP_DAYS * 24 * 60 * 60 * 1000);
  const timeline = await scopedFor(userId, client).janeMessages.findMany({
    where: { createdAt: { gte: since, lte: now } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, createdAt: true },
  });
  const answers = new Set<string>();
  timeline.forEach((m, i) => {
    if (m.kind !== "user") return;
    const next = timeline.slice(i + 1).find((n) => n.kind !== "user");
    if (next && next.createdAt.getTime() - m.createdAt.getTime() <= ANSWER_WINDOW_MS) {
      answers.add(next.id);
    }
  });
  // A choice just made floats on, marked, with Revert, until Done (founder, 2026-10-25): the
  // recently answered ones whose choice isn't settled (read here, not with a JSON filter).
  const chosen = (
    await scopedFor(userId, client).janeMessages.findMany({
      where: {
        status: "answered",
        kind: { in: ["decision", "heads_up", "brief", "done"] },
        answeredAt: { gte: since },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: MESSAGE_SELECT,
      take: POPUP_LIMIT,
    })
  )
    .map(toChatMessage)
    .filter((m) => m.refs.chosen && !m.refs.chosen.settled && !m.refs.chosen.final);
  return [...chosen, ...rows.filter((r) => !answers.has(r.id)).map(toChatMessage)].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  );
}

// Jane's first message this soon after the person typed is her answer to it.
export const ANSWER_WINDOW_MS = 5 * 60 * 1000;
