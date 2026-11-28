import { CHAT_MODEL_DOWN_HOURS } from "@/config/chat-model";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";

const WHY = "Ops events are the system's own records, no one's data";

// The red line at the top of /admin/health when the chat couldn't reach Claude lately: a key the
// store refused, the provider down, or no answer in time. Counts only. Null when all is well, so
// nobody learns of it from a screenshot of the chat (founder 11-28).
export async function chatModelLine({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}): Promise<string | null> {
  const where = {
    kind: { in: ["claude_key_refused", "chat_model_unavailable"] },
    createdAt: { gte: new Date(now.getTime() - CHAT_MODEL_DOWN_HOURS * 3_600_000), lte: now },
  };
  const ops = systemDb(WHY, client).opsEvent;
  const [refused, chat, first] = await Promise.all([
    ops.count({ where: { ...where, kind: "claude_key_refused" } }),
    ops.count({ where: { ...where, kind: "chat_model_unavailable" } }),
    ops.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  // A refused key writes both kinds for one chat turn (the call, then the turn): count the turns,
  // and the refused calls alone when only background work met the refusal.
  const count = chat > 0 ? chat : refused;
  if (count === 0 || !first) return null;
  const since = `${first.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `Chat model unavailable: ${count} refused or failed ${count === 1 ? "call" : "calls"} since ${since}`;
}
