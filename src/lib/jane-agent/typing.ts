import { conciergeMode } from "@/lib/concierge-mode";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_CLAUDE_HISTORY,
  CHAT_CLAUDE_TURN_CHARS,
  CARD_TOPIC_LOOKBACK,
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
import { overDailyCap, recordLimitHit } from "./spend";
import { answerByRules } from "./answer";
import { payeeFactsReply, payeesInQuestion, questionParts, rulesCoverQuestion } from "./backup";
import { listPreferences } from "./preferences";
import { shapeReply, styleInstructions, styleOf } from "./style";
import { joinReplies, splitQuestions } from "./two-parts";
import {
  CHAT_UNAVAILABLE_TEXT,
  askClaudeInChat,
  type ChatStreamEvent,
  type ChatTurn,
} from "./claude";
import { resolvePronoun, type Topic } from "./context";
import { typedFlowReply } from "./flows/chat";
import { parseIntent } from "./intents";
import { sinceSignIn, storeReply } from "./messages";
import { localTime } from "./quiet-hours";
import { unknownReply, type Reply } from "./replies";
import { MESSAGE_SELECT, parseRefs, toChatMessage, type ChatMessage } from "./types";
import { withReadCache } from "@/lib/read-cache";
import { listFacts, memoryForChat } from "@/lib/memory/facts";
import { learnFromChat } from "@/lib/memory/learn";

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
  // This sign-in's start (src/lib/chat-start.ts): what was said before it isn't the
  // conversation any more, so "it" and Claude's history look only after it.
  since?: Date;
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

// Spec step 88: what Jane's last answer was about, if it was in the last
// CHAT_CONTEXT_MINUTES and on the same day in the person's timezone: "it" never points at
// something from another day.
export async function lastTopic(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    since,
  }: { client?: PrismaClient; now?: Date; since?: Date } = {},
): Promise<Topic | null> {
  const [last, user] = await Promise.all([
    scopedFor(userId, client).janeMessages.findFirst({
      where: {
        kind: "reply",
        createdAt: { gte: new Date(now.getTime() - CHAT_CONTEXT_MINUTES * 60_000), lte: now },
        AND: [sinceSignIn(since)],
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

// The last card Jane put up in this conversation (a reply about a finding), same window and day
// as lastTopic: what "why?" means when the answer just before it has nothing to explain
// (answer-check sweep: "cancel Hulu", "what's my net worth", "why?" asked which one).
export async function lastCardTopic(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    since,
  }: { client?: PrismaClient; now?: Date; since?: Date } = {},
): Promise<Topic | null> {
  const [rows, user] = await Promise.all([
    scopedFor(userId, client).janeMessages.findMany({
      where: {
        kind: "reply",
        createdAt: { gte: new Date(now.getTime() - CHAT_CONTEXT_MINUTES * 60_000), lte: now },
        AND: [sinceSignIn(since)],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CARD_TOPIC_LOOKBACK,
      select: { refs: true, createdAt: true },
    }),
    client.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
  ]);
  const today = localTime(now, user?.timezone ?? null).date;
  for (const row of rows) {
    if (localTime(row.createdAt, user?.timezone ?? null).date !== today) return null;
    const topic = parseRefs(row.refs).topic;
    if (topic?.findingId) return topic;
  }
  return null;
}

// The recent typed messages and Jane's answers to them, oldest first: all Claude sees. Only this
// sign-in's with `since`: what Jane learned before is in its memory, not replayed.
export async function recentTurns(
  userId: string,
  { client = defaultClient, since }: { client?: PrismaClient; since?: Date } = {},
): Promise<ChatTurn[]> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: { kind: { in: ["user", "reply"] }, ...sinceSignIn(since) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_CLAUDE_HISTORY,
    select: { kind: true, body: true },
  });
  // What Jane couldn't answer (the "couldn't look into that" and "which one" replies) isn't
  // history Claude should see, with the question it came from: it would answer those instead.
  const turns = rows.reverse();
  const unanswered = (m: { kind: string; body: string }) =>
    m.kind === "reply" &&
    /^(?:I couldn't look into that|I couldn't write a full answer|Sorry, I couldn't finish|I've reached today's limit|I've hit today's limit|I can't answer that one yet|Which one do you mean|You've asked me a lot)/.test(
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
// The person's daily allowance of written answers is used up (founder, 2026-10-26): short and
// honest, then whatever the data answers for free.
export const DAILY_LIMIT_NOTE = "I've hit today's limit for written answers, back tomorrow.";

export type AnswerSource =
  "rules" | "claude" | "claude_blocked" | "claude_unavailable" | "fallback" | "capped";
type Source = AnswerSource;

async function answer(
  userId: string,
  text: string,
  history: ChatTurn[],
  {
    client,
    now,
    claude,
    onEvent,
    primerMs,
    since,
  }: Required<Pick<Options, "client" | "now">> & Options,
): Promise<{ reply: Reply; intent: string; source: Source; issues?: string[] }> {
  const asOf = now.toISOString().slice(0, 10);
  let intent = parseIntent(text, asOf);
  // Spec step 95: an answer typed to a guided flow's question.
  const toFlow = await typedFlowReply(text, { userId, client, now });
  if (toFlow) return { reply: toFlow, intent: "flow_answer", source: "rules" };
  // Spec step 88: what the conversation was about, for a follow-up.
  const [topic, cardTopic] = await Promise.all([
    lastTopic(userId, { client, now, since }),
    lastCardTopic(userId, { client, now, since }),
  ]);
  intent = resolvePronoun(text, intent, topic, (t) => parseIntent(t, asOf));
  // Spec step 188: how the person likes Jane to talk.
  const style = styleOf(await listPreferences(userId, { client }));
  // The rules' answer, and how many parts of the message it answered one by one (0: read whole).
  const rules = async (): Promise<{ reply: Reply; partsAnswered: number } | null> => {
    // Spec step 193: two questions in one message get both answers.
    const two = splitQuestions(text, asOf);
    if (two) {
      const replies = await Promise.all(
        two.map((part) => answerByRules(userId, part, { client, now, topic, cardTopic })),
      );
      if (replies.every((r) => r !== null)) {
        return {
          reply: shapeReply(joinReplies(replies as Reply[]), style),
          partsAnswered: two.length,
        };
      }
    }
    const reply = await answerByRules(userId, intent, { client, now, topic, cardTopic });
    return reply ? { reply: shapeReply(reply, style), partsAnswered: 0 } : null;
  };
  // The backup for when Claude can't answer (./backup.ts): the rules' answer only when it answers
  // the whole question; else what Jane can see for whoever the person named, or, for "how am I
  // doing", where they stand. Never an answer to a different question (founder 10-30).
  const backup = async ({ limited = false } = {}): Promise<Reply> => {
    const [byRules, payees] = await Promise.all([
      rules(),
      payeesInQuestion(userId, text, { client, now }),
    ]);
    if (
      byRules &&
      rulesCoverQuestion({
        text,
        intent,
        reply: byRules.reply,
        partsAnswered: byRules.partsAnswered,
        payees,
      })
    ) {
      const { reply } = byRules;
      return limited ? { ...reply, body: `${DAILY_LIMIT_NOTE} ${reply.body}` } : reply;
    }
    if (UNSAFE_REQUEST.test(text)) return { body: UNSAFE_TEXT, actions: [], refs: {} };
    if (payees.length > 0) {
      return payeeFactsReply(text, payees, limited ? { limitNote: DAILY_LIMIT_NOTE } : {});
    }
    // Where the person stands answers "how am I doing / what should I do"; for a specific
    // question it would be an unrelated status, so say plainly that it wasn't finished.
    if (!STATUS_QUESTION.test(text) || questionParts(text).length > 1) {
      return { body: limited ? DAILY_LIMIT_NOTE : UNFINISHED_TEXT, actions: [], refs: {} };
    }
    const picture = await answerByRules(
      userId,
      { kind: "whole_picture", focus: "now" },
      { client, now, topic: null },
    );
    if (!picture)
      return limited ? { body: DAILY_LIMIT_NOTE, actions: [], refs: {} } : unknownReply(text, asOf);
    return {
      ...picture,
      body: limited
        ? `${DAILY_LIMIT_NOTE} Here is where you stand. ${picture.body}`
        : `I couldn't write a full answer to that just now, so here is where you stand. ${picture.body}`,
    };
  };
  // Today's allowance of written answers for this person is used up: say so, then what the data
  // gives, with its buttons. Before the no-Claude check, so the note is the same wherever it runs.
  if (await overDailyCap(userId, { client, now })) {
    console.info("chat_timing", { outcome: "capped", reason: "daily_cap", costCents: 0 });
    await recordLimitHit(userId, { client, now }).catch(() => {});
    return { reply: await backup({ limited: true }), intent: intent.kind, source: "capped" };
  }
  // No Claude (no key: dev, tests): the rules answer, as before.
  if (!llmEnabled()) {
    const byRules = await rules();
    if (byRules) return { reply: byRules.reply, intent: intent.kind, source: "rules" };
    return { reply: unknownReply(text, asOf), intent: intent.kind, source: "fallback" };
  }
  // Chat architecture (docs/spec.md): every typed message is answered by Claude, writing from
  // Jane's tools and numbers. A button, a card or a rules answer never stands in for it.
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
    concierge: await conciergeMode(userId, { client }),
    style: styleInstructions(style),
    // What Jane knows about them from earlier: the chat starts fresh, Jane doesn't.
    memory: memoryForChat(await listFacts(userId, { client }).catch(() => [])),
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

type Sent = {
  sent: ChatMessage;
  reply: ChatMessage;
  source: AnswerSource;
  intent: string;
  issues?: string[];
};

// Answering reads the person's facts from many places, some more than once: one read each until
// something changes (src/lib/read-cache.ts).
export async function sendToJane(
  userId: string,
  raw: string,
  options: Options = {},
): Promise<Sent> {
  return withReadCache(options.client ?? defaultClient, (client) =>
    sendToJaneWork(userId, raw, { ...options, client }),
  );
}

async function sendToJaneWork(
  userId: string,
  raw: string,
  { client = defaultClient, now = new Date(), claude, onEvent, primerMs, since }: Options = {},
): Promise<Sent> {
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
  const history = await recentTurns(userId, { client, since });
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
  // What the message says about them, before the answer, so the answer knows it too.
  await learnFromChat(userId, text, `jane_message:${sent.id}`, { client, now });

  const { reply, intent, source, issues } = await answer(userId, text, history, {
    client,
    now,
    claude,
    onEvent,
    primerMs,
    since,
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
