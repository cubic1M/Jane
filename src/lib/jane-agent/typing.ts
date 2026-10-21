import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_CLAUDE_HISTORY,
  CHAT_CONTEXT_MINUTES,
  CHAT_MAX_MESSAGE,
  CHAT_RULES_ONLY_KINDS,
} from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { llmEnabled } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { giveBack, hit } from "@/lib/rate-limit";
import { answerByRules } from "./answer";
import { listPreferences } from "./preferences";
import { shapeReply, styleInstructions, styleOf } from "./style";
import { joinReplies, splitQuestions } from "./two-parts";
import { askClaudeInChat, type ChatStreamEvent, type ChatTurn } from "./claude";
import type { Topic } from "./context";
import { typedFlowReply } from "./flows/chat";
import { parseIntent } from "./intents";
import { storeReply } from "./messages";
import { localTime } from "./quiet-hours";
import { clarifyReply, nearbyChoices, unknownReply, type Reply } from "./replies";
import { MESSAGE_SELECT, parseRefs, toChatMessage, type ChatMessage } from "./types";

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

// Spec step 88: what Jane's last answer was about, if it was in the last
// CHAT_CONTEXT_MINUTES and on the same day in the person's timezone: "it" never points at
// something from another day.
export async function lastTopic(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<Topic | null> {
  const [last, user] = await Promise.all([
    scopedFor(userId, client).janeMessages.findFirst({
      where: {
        kind: "reply",
        createdAt: { gte: new Date(now.getTime() - CHAT_CONTEXT_MINUTES * 60_000), lte: now },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { refs: true, createdAt: true },
    }),
    client.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
  ]);
  if (!last) return null;
  if (
    localTime(last.createdAt, user?.timezone ?? null).date !==
    localTime(now, user?.timezone ?? null).date
  ) {
    return null;
  }
  return parseRefs(last.refs).topic ?? null;
}

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

// How an answer was given: by the rules, by Claude (or blocked, or Claude couldn't), or
// the fallback list of what Jane understands.
export type AnswerSource =
  "rules" | "claude" | "claude_blocked" | "claude_unavailable" | "fallback";
type Source = AnswerSource;

async function answer(
  userId: string,
  text: string,
  history: ChatTurn[],
  { client, now, claude, onEvent }: Required<Pick<Options, "client" | "now">> & Options,
): Promise<{ reply: Reply; intent: string; source: Source; issues?: string[] }> {
  const asOf = now.toISOString().slice(0, 10);
  const intent = parseIntent(text, asOf);
  // Spec step 89: no dead ends. An answer that couldn't be given ends with the closest
  // things Jane can answer, as buttons.
  const withNearby = (reply: Reply): Reply => {
    if (reply.actions.length > 0) return reply;
    const nearby = clarifyReply(reply.body, nearbyChoices(text, asOf));
    return { ...nearby, refs: { ...reply.refs, ...nearby.refs } };
  };
  // Spec step 95: an answer typed to a guided flow's question.
  const toFlow = await typedFlowReply(text, { userId, client, now });
  if (toFlow) return { reply: toFlow, intent: "flow_answer", source: "rules" };
  // Spec step 88: what the conversation was about, for a follow-up.
  const topic = await lastTopic(userId, { client, now });
  // Spec step 188: how the person likes Jane to talk.
  const style = styleOf(await listPreferences(userId, { client }));
  const rules = async () => {
    // Spec step 193: two questions in one message get both answers.
    const two = splitQuestions(text, asOf);
    if (two) {
      const replies = await Promise.all(
        two.map((part) => answerByRules(userId, part, { client, now, topic })),
      );
      if (replies.every((r) => r !== null)) {
        return shapeReply(joinReplies(replies as Reply[]), style);
      }
    }
    const reply = await answerByRules(userId, intent, { client, now, topic });
    return reply ? shapeReply(reply, style) : null;
  };
  // Spec step 191: exact commands, and everything when Claude isn't there, keep the instant
  // rules path.
  if (!llmEnabled() || CHAT_RULES_ONLY_KINDS.includes(intent.kind)) {
    const byRules = await rules();
    if (byRules) return { reply: byRules, intent: intent.kind, source: "rules" };
    return { reply: unknownReply(text, asOf), intent: intent.kind, source: "fallback" };
  }
  // Free text goes to Claude with every tool. Free questions count against Ask's limit too:
  // the same tools and limits; past it the rules answer.
  if (!(await hit("ask", userId, { client, now })).ok) {
    const byRules = await rules();
    return {
      reply: byRules ?? withNearby({ body: CHAT_ASK_LIMITED_TEXT, actions: [], refs: {} }),
      intent: intent.kind,
      source: byRules ? "rules" : "fallback",
    };
  }
  const result = await askClaudeInChat(userId, history, text, {
    client,
    now,
    claude,
    onEvent,
    advice: await adviceMode(userId, { client }),
    style: styleInstructions(style),
    topic,
  });
  if (result.kind === "answer") {
    return { reply: result.reply, intent: intent.kind, source: "claude" };
  }
  // Claude is slow, down, over its daily cap or blocked: the rules answer as they did before
  // Claude read everything, never a broken message. And it doesn't count against the hour's
  // free questions: Claude didn't answer it.
  await giveBack("ask", userId, { client, now }).catch(() => {});
  const fallback = await rules();
  return {
    reply: fallback ?? withNearby(result.reply),
    intent: intent.kind,
    source: result.kind === "blocked" ? "claude_blocked" : "claude_unavailable",
    // Spec step 93: which guardrail rules blocked it, codes only, never the text.
    ...(result.kind === "blocked" ? { issues: result.issues } : {}),
  };
}

export async function sendToJane(
  userId: string,
  raw: string,
  { client = defaultClient, now = new Date(), claude, onEvent }: Options = {},
): Promise<{
  sent: ChatMessage;
  reply: ChatMessage;
  source: AnswerSource;
  intent: string;
  issues?: string[];
}> {
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

  const { reply, intent, source, issues } = await answer(userId, text, history, {
    client,
    now,
    claude,
    onEvent,
  });
  // A millisecond later, so the answer always sits under the question.
  const answeredAt = new Date(now.getTime() + 1);
  const replied = await storeReply(userId, reply, { client, at: answeredAt });
  // What kind of question, never its words.
  await track(userId, "chat_message_sent", {
    intent,
    source,
    ...(issues ? { issues: issues.join(",") } : {}),
  });
  return { sent: toChatMessage(sent), reply: replied, source, intent, issues };
}
