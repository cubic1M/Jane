import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { offeredToday } from "@/lib/suggestions";

// A suggestion's own headline and working, while the dock and the chat offer it (offeredToday):
// for the page its card opens to say the card's figure and how it was worked out (the manager's
// rule, 11-22). Gone, answered or not today's pick, the page says nothing about it.
export async function offeredCard(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<{ headline: string; why: string } | null> {
  const card = (await offeredToday(userId, { client, now })).find((s) => s.key === key);
  return card ? { headline: card.headline, why: card.why } : null;
}
