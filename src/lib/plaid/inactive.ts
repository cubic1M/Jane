import { ACTIVITY_EVENTS, INACTIVE_ITEM_DAYS, REMOVAL_WARNING_DAYS } from "@/config/retention";
import type { PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { appBase } from "@/lib/digest/links";
import { removePlaidItem } from "./remove";
import { removeConnection } from "@/lib/robinhood/connection";
import { log } from "@/lib/log";
import { peopleIn, type OnlyPeople } from "@/lib/only-people";
import { systemDb } from "@/lib/system-db";

const WHY = "Cron: finds inactive people across everyone";

// Daily: people who haven't used the app for INACTIVE_ITEM_DAYS lose their Plaid and Robinhood
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

async function warn(
  email: string,
  removalDate: Date,
  send: typeof sendEmail,
  what = "your linked banks",
) {
  const date = removalDate.toISOString().slice(0, 10);
  const link = `${appBase()}/report`;
  const text = `You haven't used Jane in a while, so on ${date} we'll disconnect ${what}. That removes their accounts and transactions and what was worked out from them, and while Jane is in beta you may not be able to link them again.\n\nWant to keep them connected? Just open your report: ${link}`;
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
    log.dev(`[dev] Email to ${email}: inactivity warning\n${text}`);
    return;
  }
  await send({
    to: email,
    subject: "We'll disconnect your banks soon | Jane",
    text,
    html: `<p>You haven't used Jane in a while, so on ${date} we'll disconnect ${what}. That removes their accounts and transactions and what was worked out from them, and while Jane is in beta you may not be able to link them again.</p><p>Want to keep them connected? <a href="${link}">Open your report</a>.</p>`,
  });
}

export async function runInactiveCleanup({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
  remove = removePlaidItem,
  removeRobinhood = removeConnection,
  userIds,
}: {
  client?: PrismaClient;
  now?: Date;
  send?: typeof sendEmail;
  remove?: typeof removePlaidItem;
  removeRobinhood?: typeof removeConnection;
} & OnlyPeople = {}): Promise<InactiveRun> {
  // A system job across users: reads who has linked banks and when they were last active.
  const people = await systemDb(WHY, client).user.findMany({
    where: {
      OR: [{ plaidItems: { some: {} } }, { robinhoodConnection: { isNot: null } }],
      ...peopleIn(userIds),
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      plaidRemovalWarnedAt: true,
      plaidItems: { select: { id: true } },
      robinhoodConnection: { select: { id: true } },
    },
  });
  const last = await systemDb(WHY, client).analyticsEvent.groupBy({
    by: ["userId"],
    where: { userId: { in: people.map((p) => p.id) }, name: { in: [...ACTIVITY_EVENTS] } },
    _max: { createdAt: true },
  });
  // Any page they opened counts too: a chip of a page view isn't an event, and someone who reads
  // Home every day hasn't stopped using Jane.
  const seen = await systemDb(WHY, client).session.groupBy({
    by: ["userId"],
    where: { userId: { in: people.map((p) => p.id) } },
    _max: { lastSeenAt: true },
  });
  const lastActive = new Map<string, Date | null>(
    last.map((row) => [row.userId as string, row._max.createdAt]),
  );
  for (const row of seen) {
    const at = row._max.lastSeenAt;
    const before = lastActive.get(row.userId);
    if (at && (!before || at > before)) lastActive.set(row.userId, at);
  }

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
        await warn(
          person.email,
          new Date(now.getTime() + REMOVAL_WARNING_DAYS * DAY_MS),
          send,
          person.plaidItems.length === 0
            ? "your Robinhood connection"
            : person.robinhoodConnection
              ? "your linked banks and Robinhood"
              : "your linked banks",
        );
        await systemDb(WHY, client).user.update({
          where: { id: person.id },
          data: { plaidRemovalWarnedAt: now },
        });
        run.warned += 1;
      } else if (step === "remove") {
        for (const item of person.plaidItems) {
          await remove(person.id, item.id, "inactive", { client, actor: SYSTEM_ACTOR });
        }
        if (person.robinhoodConnection) {
          await removeRobinhood(person.id, "inactive", { client, actor: SYSTEM_ACTOR });
        }
        await systemDb(WHY, client).user.update({
          where: { id: person.id },
          data: { plaidRemovalWarnedAt: null },
        });
        run.removed += 1;
      }
    } catch (error) {
      log.error("Inactive cleanup failed", { userId: person.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
