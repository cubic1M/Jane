import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { localTime } from "@/lib/jane-agent/quiet-hours";

// The person's own "today" (founder, 2026-10-23): "due today", "as of" and the brief's and
// agenda's dates are their day, in their timezone (users.timezone, US Pacific when unknown),
// not UTC's. At 5:30pm in Los Angeles it is already tomorrow in UTC, and tomorrow's bill read
// as due today. Storage stays UTC.

export const localDate = (now: Date, timezone: string | null | undefined): string =>
  localTime(now, timezone).date;

export async function todayOf(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<string> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return localDate(now, user?.timezone);
}
