import { ASK_HISTORY_MESSAGES } from "@/config/ask";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import type { AskResult, HistoryMessage } from "./answer";

// Ask Jane conversations, always through scopedFor: a person only ever sees, continues or
// deletes their own.

type Options = { client?: PrismaClient };

const TITLE_LENGTH = 60;

export class ConversationMissingError extends Error {
  constructor() {
    super("That conversation doesn't exist.");
  }
}

// The latest messages of one of the person's conversations, oldest first.
export async function historyFor(
  userId: string,
  conversationId: string,
  { client = defaultClient }: Options = {},
): Promise<HistoryMessage[]> {
  const db = scopedFor(userId, client);
  const conversation = await db.askConversations.findFirst({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!conversation) throw new ConversationMissingError();
  const rows = await db.askMessages.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ASK_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });
  return rows
    .reverse()
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
}

// Saves a question and the reply that was shown, starting a conversation if needed.
export async function saveExchange(
  userId: string,
  conversationId: string | null,
  question: string,
  result: AskResult,
  { client = defaultClient }: Options = {},
): Promise<string> {
  const db = scopedFor(userId, client);
  const id =
    conversationId ??
    (
      await db.askConversations.create({
        data: { userId, title: question.slice(0, TITLE_LENGTH) },
        select: { id: true },
      })
    ).id;
  await db.askMessages.createMany({
    data: [
      { userId, conversationId: id, role: "user", content: question },
      {
        userId,
        conversationId: id,
        role: "assistant",
        content: result.text,
        blocked: result.kind === "blocked",
      },
    ],
  });
  await db.askConversations.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  return id;
}

export async function deleteConversation(
  userId: string,
  conversationId: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).askConversations.deleteMany({
    where: { id: conversationId },
  });
  return count > 0;
}
