import { ACTIVITY_EVENTS, INACTIVE_ITEM_DAYS, REMOVAL_WARNING_DAYS } from "@/config/retention";
import type { PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { appBase } from "@/lib/digest/links";
import { removePlaidItem } from "./remove";
import { peopleIn, type OnlyPeople } from "@/lib/only-people";

// Daily: people who haven't used the app for INACTIVE_ITEM_DAYS lose their Plaid
// connections, with an email REMOVAL_WARNING_DAYS before. Using the app at any point
// after the warning cancels it.

const DAY_MS = 24 * 60 * 60 * 1000;

export type InactiveRun = { warned: number; removed: number; failed: number };

type Person = { lastActive: Date; warnedAt: Date | null };

// Pure: what to do for one person with linked banks today.
export function inactivityStep(person: Person, now: Date): "warn" | "remove" | "none" {
  const quietDays = (now.getTime() - person.lastActive.getTime()) / DAY_MS;
  const warningStands = person.warnedAt !== null && person.warnedAt > person.lastActive;
  if (warningStands) {
    const sinceWarning = (now.getTime() - person.warnedAt!.getTime()) / DAY_MS;
    return sinceWarning >= REMOVAL_WARNING_DAYS && quietDays >= INACTIVE_ITEM_DAYS
      ? "remove"
      : "none";
  }
  return quietDays >= INACTIVE_ITEM_DAYS - REMOVAL_WARNING_DAYS ? "warn" : "none";
}

async function warn(email: string, removalDate: Date, send: typeof sendEmail) {
  const date = removalDate.toISOString().slice(0, 10);
  const link = `${appBase()}/report`;
  const text = `You haven't used Jane in a while, so on ${date} we'll disconnect your linked banks. Nothing else changes, and you can link them again anytime.\n\nWant to keep them connected? Just open your report: ${link}`;
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
    console.info(`[dev] Email to ${email}: inactivity warning\n${text}`);
    return;
  }
  await send({
    to: email,
    subject: "We'll disconnect your banks soon | Jane",
    text,
    html: `<p>You haven't used Jane in a while, so on ${date} we'll disconnect your linked banks. Nothing else changes, and you can link them again anytime.</p><p>Want to keep them connected? <a href="${link}">Open your report</a>.</p>`,
  });
}

export async function runInactiveCleanup({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
  remove = removePlaidItem,
  userIds,
}: {
  client?: PrismaClient;
  now?: Date;
  send?: typeof sendEmail;
  remove?: typeof removePlaidItem;
} & OnlyPeople = {}): Promise<InactiveRun> {
  // A system job across users: reads who has linked banks and when they were last active.
  const people = await client.user.findMany({
    where: { plaidItems: { some: {} }, ...peopleIn(userIds) },
    select: {
      id: true,
      email: true,
      createdAt: true,
      plaidRemovalWarnedAt: true,
      plaidItems: { select: { id: true } },
    },
  });
  const last = await client.analyticsEvent.groupBy({
    by: ["userId"],
    where: { userId: { in: people.map((p) => p.id) }, name: { in: [...ACTIVITY_EVENTS] } },
    _max: { createdAt: true },
  });
  const lastActive = new Map(last.map((row) => [row.userId, row._max.createdAt]));

  const run: InactiveRun = { warned: 0, removed: 0, failed: 0 };
  for (const person of people) {
    const step = inactivityStep(
      {
        lastActive: lastActive.get(person.id) ?? person.createdAt,
        warnedAt: person.plaidRemovalWarnedAt,
      },
      now,
    );
    try {
      if (step === "warn") {
        await warn(person.email, new Date(now.getTime() + REMOVAL_WARNING_DAYS * DAY_MS), send);
        await client.user.update({ where: { id: person.id }, data: { plaidRemovalWarnedAt: now } });
        run.warned += 1;
      } else if (step === "remove") {
        for (const item of person.plaidItems) {
          await remove(person.id, item.id, "inactive", { client, actor: SYSTEM_ACTOR });
        }
        await client.user.update({
          where: { id: person.id },
          data: { plaidRemovalWarnedAt: null },
        });
        run.removed += 1;
      }
    } catch (error) {
      console.error("Inactive cleanup failed", { userId: person.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
