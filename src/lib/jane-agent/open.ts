import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { chatFeed, closeSettled, postedToday } from "./messages";
import { runJaneAgentSafely } from "./run";
import { toView, type MessageView } from "./view";

// Opening the chat (spec step 81). The first visit of the day is never empty: with nothing
// posted yet today, Jane's brain runs first (quiet hours don't apply, the person is
// looking). Null when the person has no accounts yet, like Today.

// The person's timezone, for "today" and the times shown. Users have their own helpers,
// so a read of this one column by id.
export async function timezoneOf(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<string | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return user?.timezone ?? null;
}

export async function openChat(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    pages = 1,
  }: { client?: PrismaClient; now?: Date; pages?: number } = {},
): Promise<{ messages: MessageView[]; hasEarlier: boolean } | null> {
  if ((await scopedFor(userId, client).accounts.count()) === 0) return null;
  const timezone = await timezoneOf(userId, { client });
  if (await postedToday(userId, timezone, { client, now })) {
    await closeSettled(userId, { client, now });
  } else {
    await runJaneAgentSafely(userId, { client, now, trigger: "open" });
  }
  const feed = await chatFeed(userId, { client, pages, now });
  return {
    messages: feed.messages.map((m) => toView(m, now, timezone)),
    hasEarlier: feed.hasEarlier,
  };
}
