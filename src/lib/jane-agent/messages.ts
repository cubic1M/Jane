import { CHAT_PAGE_SIZE } from "@/config/agent-chat";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { PlannedMessage } from "./brain";
import { localTime } from "./quiet-hours";
import { MESSAGE_SELECT, parseActions, parseRefs, toChatMessage, type ChatMessage } from "./types";

// Reading and writing Jane's chat messages (spec step 81), always for one person.

type Options = { client?: PrismaClient; now?: Date };

// Jane's own messages, as opposed to what the person typed (step 84). Her answers to it
// ("reply") don't count either: typing before the day's first visit still gets a brief.
const JANE_KINDS = ["brief", "decision", "done", "heads_up"];

// The newest messages, oldest first (the newest at the bottom of the chat). `pages` is how
// many pages of CHAT_PAGE_SIZE to show ("Show earlier" adds one).
export async function chatFeed(
  userId: string,
  { client = defaultClient, pages = 1 }: { client?: PrismaClient; pages?: number } = {},
): Promise<{ messages: ChatMessage[]; hasEarlier: boolean }> {
  const take = CHAT_PAGE_SIZE * Math.max(1, pages);
  const rows = await scopedFor(userId, client).janeMessages.findMany({
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
    })),
    skipDuplicates: true,
    select: { kind: true, dedupeKey: true },
  });
  for (const message of created) {
    await track(userId, "chat_message_posted", {
      kind: message.kind,
      source: message.dedupeKey.split(":")[0],
    });
  }
  return created.length;
}

// Open finding messages whose finding was answered some other way (on its card, the plan,
// a rule, "Approve all safe ones") lose their buttons. So do Jane's answers that offered a
// finding's Yes and No (spec step 84).
export async function closeSettled(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const open = await db.janeMessages.findMany({
    where: { status: "open", kind: { in: ["decision", "reply"] } },
    select: { id: true, refs: true, actions: true },
  });
  const byFinding = open.flatMap((m) => {
    const findingId = parseRefs(m.refs).findingId;
    return findingId ? [{ id: m.id, findingId, actions: parseActions(m.actions) }] : [];
  });
  if (byFinding.length === 0) return 0;
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
  let closed = 0;
  for (const message of byFinding.filter((m) => !stillOpen.has(m.findingId))) {
    // Its Open link stays.
    const { count } = await db.janeMessages.updateMany({
      where: { id: message.id, status: "open" },
      data: {
        status: "answered",
        answeredAt: now,
        actions: message.actions.filter((a) => a.kind === "link") as Prisma.InputJsonArray,
      },
    });
    closed += count;
  }
  return closed;
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
