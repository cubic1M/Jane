import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_CLAUDE_HISTORY,
  CHAT_CLAUDE_TURN_CHARS,
  CHAT_CONTEXT_MINUTES,
  CHAT_MAX_MESSAGE,
} from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { llmEnabled } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { hit } from "@/lib/rate-limit";
import { claudeLimit, refundClaudeUse } from "./claude-limits";
import { overDailyCap } from "./spend";
import { answerByRules } from "./answer";
import { listPreferences } from "./preferences";
import { shapeReply, styleInstructions, styleOf } from "./style";
import { joinReplies, splitQuestions } from "./two-parts";
import {
  CHAT_UNAVAILABLE_TEXT,
  askClaudeInChat,
  type ChatStreamEvent,
  type ChatTurn,
} from "./claude";
import { resolvePronoun, withTopic, type Topic } from "./context";
import { typedFlowReply } from "./flows/chat";
import { parseIntent } from "./intents";
import { storeReply } from "./messages";
import { localTime } from "./quiet-hours";
import { unknownReply, type Reply } from "./replies";
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
  // How long Claude waits for the person's numbers (the answer checks wait for all of them).
  primerMs?: number;
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
  // What Jane couldn't answer (the "couldn't look into that" and "which one" replies) isn't
  // history Claude should see, with the question it came from: it would answer those instead.
  const turns = rows.reverse();
  const unanswered = (m: { kind: string; body: string }) =>
    m.kind === "reply" &&
    /^(?:I couldn't look into that|I couldn't write a full answer|Sorry, I couldn't finish|I've reached today's limit|I can't answer that one yet|Which one do you mean|You've asked me a lot)/.test(
      m.body,
    );
  return turns
    .filter((m, i) => !unanswered(m) && !(m.kind === "user" && unanswered(turns[i + 1] ?? m)))
    .map((m) => ({
      role: m.kind === "user" ? "user" : "assistant",
      content:
        m.body.length > CHAT_CLAUDE_TURN_CHARS
          ? `${m.body.slice(0, CHAT_CLAUDE_TURN_CHARS)}…`
          : m.body,
    }));
}

// How an answer was given: by the rules, by Claude (or blocked, or Claude couldn't), or
// the fallback list of what Jane understands.
const UNFINISHED_TEXT = "Sorry, I couldn't finish an answer to that. Please ask again.";
// "How am I doing", "what should I do": the questions where the whole picture is the answer.
const STATUS_QUESTION =
  /\b(?:how am i doing|how are (?:things|we)|where (?:do|am) i stand|what (?:should|do) i do|where (?:should|do) i start|what now|what matters|my (?:money )?situation|overview|summary)\b/i;
// Asking Jane to help hide money, forge or get around something: when Claude's own refusal
// couldn't be shown, a short refusal that needs no model.
const UNSAFE_REQUEST =
  /\b(?:hide (?:money|income|assets|cash)|forg(?:e|ing|ery)|launder\w*|evad(?:e|ing) (?:tax|taxes|the irs)|tax evasion|cheat|bypass|hack|steal|fake (?:a |an |my )?(?:id|document|signature|receipt|paystub|pay stub)|lie to|fraud\w*)\b/i;
const UNSAFE_TEXT =
  "I can't help with that. I'm glad to help with your spending, bills, savings or taxes the honest way.";
const DAILY_LIMIT_LEAD = "I've reached today's limit for answering in detail";

export type AnswerSource =
  "rules" | "claude" | "claude_blocked" | "claude_unavailable" | "fallback" | "capped";
type Source = AnswerSource;

async function answer(
  userId: string,
  text: string,
  history: ChatTurn[],
  { client, now, claude, onEvent, primerMs }: Required<Pick<Options, "client" | "now">> & Options,
): Promise<{ reply: Reply; intent: string; source: Source; issues?: string[] }> {
  const asOf = now.toISOString().slice(0, 10);
  let intent = parseIntent(text, asOf);
  // Spec step 95: an answer typed to a guided flow's question.
  const toFlow = await typedFlowReply(text, { userId, client, now });
  if (toFlow) return { reply: toFlow, intent: "flow_answer", source: "rules" };
  // Spec step 88: what the conversation was about, for a follow-up.
  const topic = await lastTopic(userId, { client, now });
  intent = resolvePronoun(text, intent, topic, (t) => parseIntent(t, asOf));
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
  // The backup for when Claude can't answer: the rules' answer from the same data, or, for
  // anything they can't place, where the person stands (never a bare "unavailable").
  const backup = async (
    lead = "I couldn't write a full answer to that just now",
  ): Promise<Reply> => {
    const byRules = await rules();
    if (byRules)
      return lead === DAILY_LIMIT_LEAD ? { ...byRules, body: `${lead}. ${byRules.body}` } : byRules;
    // Where the person stands answers "how am I doing / what should I do"; for a specific
    // question it would be an unrelated status, so say plainly that it wasn't finished.
    if (UNSAFE_REQUEST.test(text)) return { body: UNSAFE_TEXT, actions: [], refs: {} };
    if (!STATUS_QUESTION.test(text)) {
      return {
        body: lead === DAILY_LIMIT_LEAD ? `${lead}. Please ask again tomorrow.` : UNFINISHED_TEXT,
        actions: [],
        refs: {},
      };
    }
    const picture = await answerByRules(
      userId,
      { kind: "whole_picture", focus: "now" },
      { client, now, topic: null },
    );
    return picture
      ? { ...picture, body: `${lead}, so here is where you stand. ${picture.body}` }
      : unknownReply(text, asOf);
  };
  // No Claude (no key: dev, tests): the rules answer, as before.
  if (!llmEnabled()) {
    const byRules = await rules();
    if (byRules) return { reply: byRules, intent: intent.kind, source: "rules" };
    return { reply: unknownReply(text, asOf), intent: intent.kind, source: "fallback" };
  }
  // Chat architecture (docs/spec.md): every typed message is answered by Claude, writing from
  // Jane's tools and numbers. A button, a card or a rules answer never stands in for it.
  // Today's spend on this person is used up: say so, then what the data gives.
  if (await overDailyCap(userId, { client, now })) {
    console.info("chat_timing", { outcome: "capped", reason: "daily_cap", costCents: 0 });
    return {
      reply: await backup(DAILY_LIMIT_LEAD),
      intent: intent.kind,
      source: "claude_unavailable",
    };
  }
  const limit = await claudeLimit(userId, { client, now });
  if (limit === "budget") {
    return { reply: await backup(), intent: intent.kind, source: "claude_unavailable" };
  }
  if (limit) {
    return {
      reply: { body: limit.text, actions: [], refs: {} },
      intent: intent.kind,
      source: "capped",
    };
  }
  // Whatever goes wrong inside, the person gets an answer from the data, never a crash.
  const result = await askClaudeInChat(userId, history, text, {
    client,
    now,
    claude,
    onEvent,
    primerMs,
    advice: await adviceMode(userId, { client }),
    style: styleInstructions(style),
    topic,
  }).catch((error): Awaited<ReturnType<typeof askClaudeInChat>> => {
    console.error("Jane's chat failed unexpectedly", { error: String(error).slice(0, 300) });
    return { kind: "unavailable", reply: { body: CHAT_UNAVAILABLE_TEXT, actions: [], refs: {} } };
  });
  if (result.kind === "answer") {
    return { reply: result.reply, intent: intent.kind, source: "claude" };
  }
  // Claude failed twice, ran out of time, hit a cap or was blocked: a short answer from the
  // same data, and it doesn't count against the person's allowance.
  await refundClaudeUse(userId, { client, now });
  return {
    reply: await backup(),
    intent: intent.kind,
    source: result.kind === "blocked" ? "claude_blocked" : "claude_unavailable",
    // Spec step 93: which guardrail rules blocked it, codes only, never the text.
    ...(result.kind === "blocked" ? { issues: result.issues } : {}),
  };
}

export async function sendToJane(
  userId: string,
  raw: string,
  { client = defaultClient, now = new Date(), claude, onEvent, primerMs }: Options = {},
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
    primerMs,
  });
  // A millisecond later, so the answer always sits under the question.
  const answeredAt = new Date(now.getTime() + 1);
  // Whatever the answer was, even one that failed, the next \"why\" is about THIS question,
  // not an older topic.
  if (!reply.refs.topic) {
    reply.refs = { ...reply.refs, topic: { kind: "asked", target: text.slice(0, 80) } };
  }
  const replied = await storeReply(userId, reply, { client, at: answeredAt });
  // What kind of question, never its words.
  await track(userId, "chat_message_sent", {
    intent,
    source,
    ...(issues ? { issues: issues.join(",") } : {}),
  });
  return { sent: toChatMessage(sent), reply: replied, source, intent, issues };
}
