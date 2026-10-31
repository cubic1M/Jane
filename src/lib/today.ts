import { cache } from "react";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { validTimezone } from "@/lib/digest/week";
import { localTime } from "@/lib/jane-agent/quiet-hours";
import { cachedRead } from "@/lib/read-cache";

// The person's own "today" (founder, 2026-10-23): "due today", "as of" and the brief's and
// agenda's dates are their day, in their timezone (users.timezone, US Pacific when unknown),
// not UTC's. At 5:30pm in Los Angeles it is already tomorrow in UTC, and tomorrow's bill read
// as due today. Storage stays UTC.

export const localDate = (now: Date, timezone: string | null | undefined): string =>
  localTime(now, timezone).date;

const timezoneFrom = async (userId: string, client: PrismaClient) =>
  (await client.user.findUnique({ where: { id: userId }, select: { timezone: true } }))?.timezone;
// Read once per server render (React's cache): a page asks for the day many times over.
const timezoneOnce = cache((userId: string) => timezoneFrom(userId, defaultClient));

export async function todayOf(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<string> {
  const timezone =
    client === defaultClient
      ? await timezoneOnce(userId)
      : await cachedRead(`timezone:${userId}`, client, () => timezoneFrom(userId, client));
  return localDate(now, timezone);
}

// The person's timezone for labelling moments (momentLabel in src/lib/day-label.ts): theirs, or
// US Pacific when unknown or not a real zone.
export async function timezoneOf(userId: string): Promise<string> {
  return validTimezone(await timezoneOnce(userId));
}
