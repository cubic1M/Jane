import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { CHAT_CLAUDE_HISTORY, CHAT_MAX_MESSAGE } from "@/config/agent-chat";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { llmEnabled } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { hit } from "@/lib/rate-limit";
import { answerByRules } from "./answer";
import { askClaudeInChat, type ChatStreamEvent, type ChatTurn } from "./claude";
import { parseIntent } from "./intents";
import { unknownReply, type Reply } from "./replies";
import { MESSAGE_SELECT, toChatMessage, type ChatMessage } from "./types";

// Typing to Jane (spec step 84). What the person types is stored as a "user" message and
// Jane's answer as a "reply", right after it. Rules answer first (./intents, ./answer);
// anything they can't place goes to Claude when there's a key (./claude), else a list of
// what Jane understands. Typing never acts by itself: an answer can only carry buttons
// from the action registry, each checked again when tapped. Typed text is the person's
// data: it's in Download my data, deleted with the account, and never logged.

type Options = {
  client?: PrismaClient;
  now?: Date;
  claude?: () => Pick<Anthropic, "messages">;
  // Claude's answer as it's written, and what Jane is looking up (./claude).
  onEvent?: (event: ChatStreamEvent) => void;
};

export type ChatInputErrorCode = "empty" | "too_long" | "rate_limited";

export class ChatInputError extends Error {
  constructor(
    readonly code: ChatInputErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// Shown when free questions are over Ask's own limit for the hour.
export const CHAT_ASK_LIMITED_TEXT =
  'You\'ve asked me a lot of free questions this hour, so give me a little while. The questions in "help" still work now.';

// The recent typed messages and Jane's answers to them, oldest first: all Claude sees.
export async function recentTurns(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<ChatTurn[]> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: { kind: { in: ["user", "reply"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_CLAUDE_HISTORY,
    select: { kind: true, body: true },
  });
  return rows
    .reverse()
    .map((m) => ({ role: m.kind === "user" ? "user" : "assistant", content: m.body }));
}

type Source = "rules" | "claude" | "claude_blocked" | "claude_unavailable" | "fallback";

async function answer(
  userId: string,
  text: string,
  history: ChatTurn[],
  { client, now, claude, onEvent }: Required<Pick<Options, "client" | "now">> & Options,
): Promise<{ reply: Reply; intent: string; source: Source }> {
  const intent = parseIntent(text, now.toISOString().slice(0, 10));
  const byRules = await answerByRules(userId, intent, { client, now });
  if (byRules) return { reply: byRules, intent: intent.kind, source: "rules" };
  if (!llmEnabled()) return { reply: unknownReply(), intent: intent.kind, source: "fallback" };
  // Free questions count against Ask's limit too: the same tools and limits.
  if (!(await hit("ask", userId, { client, now })).ok) {
    return {
      reply: { body: CHAT_ASK_LIMITED_TEXT, actions: [], refs: {} },
      intent: intent.kind,
      source: "fallback",
    };
  }
  const result = await askClaudeInChat(userId, history, text, {
    client,
    now,
    claude,
    onEvent,
  });
  const source: Source =
    result.kind === "answer"
      ? "claude"
      : result.kind === "blocked"
        ? "claude_blocked"
        : "claude_unavailable";
  return { reply: result.reply, intent: intent.kind, source };
}

export async function sendToJane(
  userId: string,
  raw: string,
  { client = defaultClient, now = new Date(), claude, onEvent }: Options = {},
): Promise<{ sent: ChatMessage; reply: ChatMessage }> {
  const text = raw.trim();
  if (!text) throw new ChatInputError("empty", "Type a message first.");
  if (text.length > CHAT_MAX_MESSAGE) {
    throw new ChatInputError("too_long", `Keep it under ${CHAT_MAX_MESSAGE} characters.`);
  }
  const limit = await hit("chat", userId, { client, now });
  if (!limit.ok) {
    throw new ChatInputError(
      "rate_limited",
      "That's a lot of messages. Try again in a little while.",
    );
  }

  const db = scopedFor(userId, client);
  const history = await recentTurns(userId, { client });
  const key = randomUUID();
  const sent = await db.janeMessages.create({
    data: {
      userId,
      kind: "user",
      body: text,
      status: "answered",
      dedupeKey: `typed:${key}`,
      createdAt: now,
      readAt: now,
    },
    select: MESSAGE_SELECT,
  });

  const { reply, intent, source } = await answer(userId, text, history, {
    client,
    now,
    claude,
    onEvent,
  });
  // A millisecond later, so the answer always sits under the question.
  const answeredAt = new Date(now.getTime() + 1);
  const replied = await db.janeMessages.create({
    data: {
      userId,
      kind: "reply",
      body: reply.body,
      refs: reply.refs as Prisma.InputJsonObject,
      actions: reply.actions as Prisma.InputJsonArray,
      dedupeKey: `reply:${key}`,
      createdAt: answeredAt,
      readAt: answeredAt,
    },
    select: MESSAGE_SELECT,
  });
  // What kind of question, never its words.
  await track(userId, "chat_message_sent", { intent, source });
  return { sent: toChatMessage(sent), reply: toChatMessage(replied) };
}
