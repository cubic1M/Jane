import { FULL_MONTH_START_SLACK_DAYS } from "@/config/budgets";
import { DATA_ENDED_AFTER_DAYS } from "@/config/insights";
import { daysBetween, isoDate } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

// The day a person's transactions end, when that's long enough ago that it isn't just a quiet
// week. Null while they're current, or with none at all (that's its own answer).
export const endedOn = (lastDate: string | null, today: string): string | null =>
  lastDate !== null && daysBetween(lastDate, today) > DATA_ENDED_AFTER_DAYS ? lastDate : null;

// The day a month is cut short at, when the data ends (endedOn) more than a week before the
// month does: the start's slack (FULL_MONTH_START_SLACK_DAYS) at its end, so a statement to the 28th
// is the month. Null for a month the data covers to its end, or one it doesn't end in.
export function monthCutShortAt(month: string, ended: string | null): string | null {
  if (ended === null || ended.slice(0, 7) !== month) return null;
  const monthEnd = isoDate(
    new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)),
  );
  return daysBetween(ended, monthEnd) > FULL_MONTH_START_SLACK_DAYS ? ended : null;
}

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
