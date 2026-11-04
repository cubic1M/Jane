import { DATA_ENDED_AFTER_DAYS } from "@/config/insights";
import { daysBetween, isoDate } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

// The day a person's transactions end, when that's long enough ago that it isn't just a quiet
// week. Null while they're current, or with none at all (that's its own answer).
export const endedOn = (lastDate: string | null, today: string): string | null =>
  lastDate !== null && daysBetween(lastDate, today) > DATA_ENDED_AFTER_DAYS ? lastDate : null;

export async function dataEndedOn(
  userId: string,
  { client, today }: { client: PrismaClient; today: string },
): Promise<string | null> {
  const last = await scopedFor(userId, client).transactions.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return endedOn(last ? isoDate(last.date) : null, today);
}

export const DATA_ENDED_LINE = (day: string) =>
  `What I have ends on ${day}, so this may be out of date.`;
