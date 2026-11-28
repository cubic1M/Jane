import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/log";
import { scopedFor } from "@/lib/db-scoped";
import { parseRefs } from "./types";

// "Clear chat" (founder 11-28: "an option to refresh the chat, so all history is gone"): every
// message the person typed and every answer Jane gave, for good, with Ask Jane's saved
// conversations and the pins on what is left. The chat starts empty, as for a new one.
//
// What stays: what Jane knows about the person (facts and preferences: Settings > Memory has
// "Forget" and "Delete all memory" for those), the suggestions Jane posted (cards waiting on the
// person, and what was decided), and all the money data. Nothing is kept of the old messages for
// the next answer to quote: Claude is shown only the chat's own messages (src/lib/jane-agent/
// typing.ts recentTurns), the topic of the last answer lives on that answer, and the person's
// numbers (the primer) hold no chat.

export type ClearedChat = { messages: number; conversations: number; unpinned: number };

export async function clearChat(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<ClearedChat> {
  const db = scopedFor(userId, client);
  // One transaction: all of it goes, or none.
  const counts = await db.transaction(async (tx) => {
    const messages = await tx.janeMessages.deleteMany({
      where: { kind: { in: ["user", "reply"] } },
    });
    const conversations = await tx.askConversations.deleteMany({});
    // A pin on a card that stays (a suggestion) goes, so no "Pinned" line is left over.
    const pinned = await tx.janeMessages.findMany({
      where: { refs: { path: ["pinned"], equals: true } },
      select: { id: true, refs: true },
    });
    for (const row of pinned) {
      const refs = { ...parseRefs(row.refs) };
      delete refs.pinned;
      await tx.janeMessages.update({ where: { id: row.id }, data: { refs } });
    }
    return {
      messages: messages.count,
      conversations: conversations.count,
      unpinned: pinned.length,
    };
  });
  // Counts only, never a word of what was said. The deletion has committed: a failed audit write is
  // logged, and never turns it into an error for the person.
  try {
    await logAudit(
      { type: "user", id: userId },
      "chat_cleared",
      { type: "user", id: userId },
      counts,
    );
  } catch (error) {
    log.error("chat_cleared not audited", { error: String(error).slice(0, 200) });
  }
  try {
    await track(userId, "chat_cleared", {
      messages: counts.messages,
      conversations: counts.conversations,
    });
  } catch (error) {
    // The chat is already cleared: a failed analytics write must not say otherwise.
    log.error("chat_cleared not recorded", { error: String(error).slice(0, 200) });
  }
  return counts;
}
