import { CHAT_CRON_LIMIT, CHAT_HISTORY_HOURS } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { policiesFromPayments } from "@/lib/found-policies";
import { runPlanUpkeep } from "@/lib/plan-upkeep";
import { gather, plan, type BrainSettings } from "./brain";
import { closeSettled, postMessages } from "./messages";
import { queueChatNotificationsSafely } from "./notify";
import { inQuietHours } from "./quiet-hours";
import { loadSnapshot } from "./snapshot";
import type { Trigger } from "./sources";

// Runs Jane's brain for one person (spec step 82): loads what it looks at with the
// existing loaders, reads what Jane already said, asks the brain what to say and posts it.
// Called after a bank or demo-bank sync, after a CSV import, by the daily job, and when the
// person opens the chat with nothing posted yet today.

type Options = { client?: PrismaClient; now?: Date; trigger?: Trigger };

const HOUR_MS = 60 * 60 * 1000;

export async function runJaneAgent(
  userId: string,
  { client = defaultClient, now = new Date(), trigger = "sync" }: Options = {},
): Promise<{ posted: number }> {
  // The person's timezone, for quiet hours: users have their own helpers, so read by id.
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  if (!user) return { posted: 0 };
  // Nothing to say in quiet hours, so nothing to load, unless the person is looking.
  if (trigger !== "open" && inQuietHours(now, user.timezone)) return { posted: 0 };

  // Spec step 101: what autopilot keeps up to date by itself, before Jane looks.
  await runPlanUpkeep(userId, { client, now }).catch((error) =>
    console.error("Plan upkeep failed", { userId, error: String(error) }),
  );
  // Spec step 99: insurance found from payments joins the profile (as found) by itself.
  await policiesFromPayments(userId, { client, now }).catch((error) =>
    console.error("Finding policies from payments failed", { userId, error: String(error) }),
  );
  const snapshot = await loadSnapshot(userId, { client, now });
  if (!snapshot) return { posted: 0 };
  await closeSettled(userId, { client, now });

  const settings: BrainSettings = { trigger };
  const db = scopedFor(userId, client);
  const keys = gather(snapshot, now, settings).map((c) => c.dedupeKey);
  const [seen, recent] = await Promise.all([
    keys.length === 0
      ? []
      : db.janeMessages.findMany({
          where: { dedupeKey: { in: keys } },
          select: { dedupeKey: true, snoozedUntil: true },
        }),
    db.janeMessages.findMany({
      where: { createdAt: { gte: new Date(now.getTime() - CHAT_HISTORY_HOURS * HOUR_MS) } },
      select: { kind: true, dedupeKey: true, createdAt: true },
    }),
  ]);
  const planned = plan(
    snapshot,
    {
      recent,
      seenKeys: seen.map((s) => s.dedupeKey),
      // Spec step 83: what the person said "Not now" to, and until when.
      snoozed: seen.flatMap((s) =>
        s.snoozedUntil ? [{ dedupeKey: s.dedupeKey, until: s.snoozedUntil }] : [],
      ),
    },
    now,
    settings,
  );
  const posted = await postMessages(userId, planned, { client, now });
  // What's important goes out as a notification, unless the person is looking (spec step 85).
  await queueChatNotificationsSafely(userId, { client, now, trigger });
  return { posted };
}

// Never lets Jane's chat fail what called it (a sync, an import): logs and moves on.
export async function runJaneAgentSafely(userId: string, options: Options = {}): Promise<void> {
  try {
    await runJaneAgent(userId, options);
  } catch (error) {
    console.error("Jane's chat run failed", { userId, error: String(error) });
  }
}

// The daily job: everyone with accounts, the longest since Jane last posted to them first,
// at most CHAT_CRON_LIMIT a run. Quiet hours are left to runJaneAgent.
export async function runJaneAgentForAll({
  client = defaultClient,
  now = new Date(),
  limit = CHAT_CRON_LIMIT,
  run: runOne = runJaneAgent,
}: {
  client?: PrismaClient;
  now?: Date;
  limit?: number;
  run?: typeof runJaneAgent;
} = {}): Promise<{
  people: number;
  posted: number;
  failed: number;
}> {
  // A system job across all users: it reads ids and when Jane last posted, nothing else;
  // runJaneAgent scopes everything after to the one person.
  const users = await client.user.findMany({
    where: { deletedAt: null, accounts: { some: {} } },
    select: {
      id: true,
      janeMessages: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { id: "asc" },
  });
  const last = (u: (typeof users)[number]) => u.janeMessages[0]?.createdAt.getTime() ?? 0;
  const batch = [...users].sort((a, b) => last(a) - last(b)).slice(0, limit);

  const run = { people: batch.length, posted: 0, failed: 0 };
  for (const user of batch) {
    try {
      run.posted += (await runOne(user.id, { client, now, trigger: "cron" })).posted;
    } catch (error) {
      run.failed += 1;
      console.error("Jane's daily chat run failed", { userId: user.id, error: String(error) });
    }
  }
  return run;
}
