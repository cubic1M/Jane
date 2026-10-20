import {
  CHAT_CRON_LIMIT,
  CHAT_HISTORY_HOURS,
  CHAT_TYPING_PAUSE_MINUTES,
} from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { refreshDebts } from "@/lib/debt-refresh";
import { scopedFor } from "@/lib/db-scoped";
import { loadDetectionInput } from "@/detection/engine";
import { policiesFromPayments } from "@/lib/found-policies";
import { runPaycheckPlan } from "@/lib/money-movement/paycheck";
import { settleTransfers } from "@/lib/money-movement/transfers";
import { runBillPay } from "@/lib/money-movement/bill-pay";
import { healthFor } from "@/lib/health-score";
import { monthlyReportFor } from "@/lib/monthly-report";
import { runLeanCheck } from "@/lib/lean-plan";
import { loadYearPlan } from "@/lib/year-plan";
import { runPlanUpkeep } from "@/lib/plan-upkeep";
import { runTaxAutopilotSafely } from "@/lib/tax-autopilot";
import { gather, plan, type BrainSettings } from "./brain";
import { BUNDLED_UNTIL, closeSettled, postMessages } from "./messages";
import { queueChatNotificationsSafely } from "./notify";
import { inQuietHours } from "./quiet-hours";
import { listPreferences, postingOf } from "./preferences";
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
  // Spec step 92: never interrupt. While they're chatting, Jane's own messages wait.
  if (await chatting(userId, { client, now })) return { posted: 0 };

  // Spec step 101: what autopilot keeps up to date by itself, before Jane looks.
  await runPlanUpkeep(userId, { client, now }).catch((error) =>
    console.error("Plan upkeep failed", { userId, error: String(error) }),
  );
  // Loans and debt (spec Phase Y): what Jane keeps current by herself, before she looks.
  await refreshDebts(userId, { client, now });
  // The bank data, loaded once for what follows.
  const input = await loadDetectionInput(userId, { client, now });
  // Spec step 99: insurance found from payments joins the profile (as found) by itself.
  await policiesFromPayments(userId, { client, now, input }).catch((error) =>
    console.error("Finding policies from payments failed", { userId, error: String(error) }),
  );
  // Spec step 205: the year's plan, re-planned from what happened and kept.
  await loadYearPlan(userId, { client, now, input, keep: true }).catch((error) =>
    console.error("Year plan failed", { userId, error: String(error) }),
  );
  // Spec step 204: a paycheck that hasn't come in gets one question; pay back ends the plan.
  await runLeanCheck(userId, { client, now, input }).catch((error) =>
    console.error("Lean check failed", { userId, error: String(error) }),
  );
  // Spec step 144: transfers whose day came have gone through, and a new paycheck gets its
  // plan (moved by itself where autopilot allows).
  await settleTransfers(userId, { client, now }).catch((error) =>
    console.error("Settling transfers failed", { userId, error: String(error) }),
  );
  await runPaycheckPlan(userId, { client, now, input }).catch((error) =>
    console.error("Paycheck plan failed", { userId, error: String(error) }),
  );
  // Spec step 145: bills due soon that autopilot may pay, scheduled on time.
  await runBillPay(userId, { client, now, input }).catch((error) =>
    console.error("Bill pay failed", { userId, error: String(error) }),
  );
  // Spec step 146: this month's money health score, kept for next month's comparison.
  await healthFor(userId, { client, now, input, keep: true }).catch((error) =>
    console.error("Health score failed", { userId, error: String(error) }),
  );
  // Spec step 148: in the first days of a month, last month's report, made once.
  await monthlyReportFor(userId, { client, now }).catch((error) =>
    console.error("Monthly report failed", { userId, error: String(error) }),
  );
  // Taxes (spec steps 123–127): what Jane sets up by herself, at the person's level.
  await runTaxAutopilotSafely(userId, { client, now });
  const snapshot = await loadSnapshot(userId, { client, now, input });
  if (!snapshot) return { posted: 0 };
  await closeSettled(userId, { client, now });

  // Spec step 184: the day as one agenda message, plus whatever is urgent, unless the person
  // wants things as they come.
  const posting = postingOf(await listPreferences(userId, { client }));
  const settings: BrainSettings = { trigger, agenda: posting === "daily" };
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
      where: {
        createdAt: { gte: new Date(now.getTime() - CHAT_HISTORY_HOURS * HOUR_MS) },
        // Findings behind a bundle (spec step 92) don't count toward the day.
        OR: [{ snoozedUntil: null }, { snoozedUntil: { not: BUNDLED_UNTIL } }],
      },
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

// Spec step 92: whether the person typed to Jane in the last CHAT_TYPING_PAUSE_MINUTES.
export async function chatting(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<boolean> {
  const since = new Date(now.getTime() - CHAT_TYPING_PAUSE_MINUTES * 60_000);
  return (
    (await scopedFor(userId, client).janeMessages.count({
      where: { kind: "user", createdAt: { gt: since, lte: now } },
    })) > 0
  );
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
