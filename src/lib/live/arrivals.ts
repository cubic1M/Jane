import {
  LIVE_NOTICE_MIN_ANNUAL_CENTS,
  LIVE_NOTICE_MIN_CONFIDENCE,
  LIVE_NOTICES_PER_DAY,
  LIVE_WEBHOOK_WINDOW_MINUTES,
} from "@/config/detection";
import { PLAN_URGENT_FINDING_TYPES } from "@/config/plan";
import { atLeast } from "@/detection/helpers";
import type { FindingType, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { comparisonFor } from "@/lib/compare";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { hasDemoBank } from "@/lib/plaid/demo";
import { tellsThemToAct } from "@/lib/real-account-text";
import { savingsLine } from "@/lib/savings-text";
import { systemDb } from "@/lib/system-db";
import { isTrialUser } from "@/lib/trial-ids";
import { postMessages } from "@/lib/jane-agent/messages";
import { queueChatNotificationsSafely } from "@/lib/jane-agent/notify";
import { inQuietHours } from "@/lib/jane-agent/quiet-hours";
import { chatting } from "@/lib/jane-agent/run";
import { findingFingerprint, type SnapshotFinding } from "@/lib/jane-agent/snapshot";
import { findingCandidate } from "@/lib/jane-agent/sources/findings";

// Jane's 24/7 engine, step one: a scan set off by a change (a bank's webhook, a sync, an offer
// that moved) has just created findings. Each is recorded once, with what set it off and how long
// it took, and the best one that clears the bar (src/config/detection/live.ts) is told to the
// person now: posted in the chat as the same question the brain would ask tomorrow (so it's never
// asked twice), and sent the way the person hears from Jane (quiet hours, their channel, the
// lock-screen wording: src/lib/jane-agent/notify.ts). At most LIVE_NOTICES_PER_DAY a day. Never to a
// sample person or a demo bank, never during a first scan (the first brief tells them everything).
// Running it again for the same findings changes nothing.

export type Trigger = "webhook" | "sync" | "import" | "offer" | "daily";
export type Notice =
  | "posted"
  | "first_scan"
  | "below_bar"
  | "quiet_hours"
  | "chatting"
  | "today_used"
  | "sample"
  | "demo"
  | "failed";

const DAY_MS = 24 * 60 * 60 * 1000;

type Created = { type: FindingType; key: string };
type Arrived = {
  id: string;
  type: FindingType;
  title: string;
  annualSavingsCents: number | null;
  confidence: "low" | "medium" | "high";
  evidence: unknown;
};

export type ArrivalOptions = {
  client?: PrismaClient;
  now?: Date;
  trigger: Trigger;
  // When the change happened: a webhook's arrival, or when the scan started.
  triggerAt: Date;
  // When the finding existed: the clock now, not the scan's own `now` (that's when it started).
  foundAt?: Date;
  firstScan?: boolean;
};

// Worth telling someone about straight away.
export const clearsBar = (f: Pick<Arrived, "annualSavingsCents" | "confidence">): boolean =>
  (f.annualSavingsCents ?? 0) >= LIVE_NOTICE_MIN_ANNUAL_CENTS &&
  atLeast(f.confidence, LIVE_NOTICE_MIN_CONFIDENCE);

// Biggest yearly saving first; ties by id, so two runs pick the same one.
const byValue = (a: Arrived, b: Arrived) =>
  (b.annualSavingsCents ?? 0) - (a.annualSavingsCents ?? 0) || a.id.localeCompare(b.id);

// Why nobody may be told anything now, whatever was found; null when someone may be.
async function heldForEveryone(
  userId: string,
  { client, now, firstScan }: { client: PrismaClient; now: Date; firstScan: boolean },
): Promise<Notice | null> {
  if (firstScan) return "first_scan";
  if (isTrialUser(userId)) return "sample";
  if (await hasDemoBank(userId, { client })) return "demo";
  const me = await scopedFor(userId, client).me.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (inQuietHours(now, me?.timezone)) return "quiet_hours";
  if (await chatting(userId, { client, now })) return "chatting";
  return null;
}

// The chat's question about one finding, exactly as the findings source writes it.
async function questionAbout(userId: string, finding: Arrived, client: PrismaClient, now: Date) {
  const comparison = await comparisonFor(finding, { userId, client, now });
  const snapshotFinding: SnapshotFinding = {
    findingId: finding.id,
    type: finding.type,
    title: finding.title,
    annualSavingsCents: finding.annualSavingsCents,
    savings: savingsLine(finding.type, finding.annualSavingsCents),
    fingerprint: findingFingerprint(finding),
    urgent: PLAN_URGENT_FINDING_TYPES.includes(finding.type),
    confidence: finding.confidence,
    pick: comparison
      ? {
          optionId: comparison.pick.option.id,
          name: comparison.pick.option.name,
          savingCents: comparison.pick.savingCents,
          savings: comparison.current.kind === "savings",
        }
      : null,
  };
  const candidate = findingCandidate(snapshotFinding, await conciergeMode(userId, { client }));
  // A real account is never told to act (src/lib/real-account-text.ts), as the brain filters it.
  if (!(await adviceMode(userId, { client })) && tellsThemToAct(candidate.body)) return null;
  // The brain's own key (src/lib/jane-agent/brain.ts gather), so it never asks this again.
  return { ...candidate, source: "findings", dedupeKey: `findings:${candidate.dedupeKey}` };
}

export async function recordArrivals(
  userId: string,
  created: readonly Created[],
  {
    client = defaultClient,
    now = new Date(),
    trigger,
    triggerAt,
    foundAt = new Date(),
    firstScan = false,
  }: ArrivalOptions,
): Promise<{ recorded: number; posted: string | null }> {
  if (created.length === 0) return { recorded: 0, posted: null };
  const db = scopedFor(userId, client);
  const found = (await db.findings.findMany({
    where: {
      OR: created.map((c) => ({ type: c.type, key: c.key })),
      arrival: { is: null },
    },
    select: {
      id: true,
      type: true,
      title: true,
      annualSavingsCents: true,
      confidence: true,
      evidence: true,
    },
  })) as Arrived[];
  if (found.length === 0) return { recorded: 0, posted: null };

  const held = await heldForEveryone(userId, { client, now, firstScan });
  const best = held ? null : ([...found].filter(clearsBar).sort(byValue)[0] ?? null);
  const sentToday = best
    ? await db.findingArrivals.count({
        where: { notice: "posted", createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
      })
    : 0;
  const noticeOf = (f: Arrived): Notice => {
    if (held) return held;
    if (!clearsBar(f)) return "below_bar";
    if (f.id !== best?.id || sentToday >= LIVE_NOTICES_PER_DAY) return "today_used";
    return "posted";
  };
  const rows = found.map((f) => ({
    userId,
    findingId: f.id,
    trigger,
    triggerAt,
    foundAt,
    latencyMs: Math.max(0, foundAt.getTime() - triggerAt.getTime()),
    notice: noticeOf(f),
    // The day's count reads this, against the same clock as the rest of the run.
    createdAt: now,
  }));
  // The unique finding id: a scan running twice over the same change records each once.
  const inserted = await db.findingArrivals.createManyAndReturn({
    data: rows,
    skipDuplicates: true,
    select: { id: true, findingId: true, notice: true, latencyMs: true },
  });
  for (const row of inserted) {
    log.info("live_finding", { trigger, latencyMs: row.latencyMs, notice: row.notice });
  }
  const mine = inserted.find((r) => r.notice === "posted");
  if (!mine || !best) return { recorded: inserted.length, posted: null };

  // Two scans at once (two banks' webhooks) may each think today's is free: only the first counts.
  const first = await db.findingArrivals.findMany({
    where: { notice: "posted", createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LIVE_NOTICES_PER_DAY,
    select: { id: true },
  });
  const settle = (notice: Notice) =>
    db.findingArrivals.updateMany({ where: { id: mine.id }, data: { notice } });
  if (!first.some((r) => r.id === mine.id)) {
    await settle("today_used");
    return { recorded: inserted.length, posted: null };
  }
  try {
    const question = await questionAbout(userId, best, client, now);
    if (!question) {
      await settle("below_bar");
      return { recorded: inserted.length, posted: null };
    }
    await postMessages(userId, [question], { client, now });
    await queueChatNotificationsSafely(userId, { client, now, trigger: "sync" });
    return { recorded: inserted.length, posted: best.id };
  } catch (error) {
    log.error("Telling the person about a new finding failed", { error: String(error) });
    await settle("failed");
    return { recorded: inserted.length, posted: null };
  }
}

// Never lets the engine fail what called it (a sync, an import).
export async function recordArrivalsSafely(
  userId: string,
  created: readonly Created[],
  options: ArrivalOptions,
): Promise<void> {
  try {
    await recordArrivals(userId, created, options);
  } catch (error) {
    log.error("Recording new findings failed", { error: String(error) });
  }
}

const WEBHOOK_WHY = "Plaid's webhook log has no owner: read by the item's Plaid id";

// What set a bank's sync off: the Plaid webhook that arrived for it in the last
// LIVE_WEBHOOK_WINDOW_MINUTES (src/lib/plaid/webhooks.ts keeps each delivery), else the sync itself.
export async function whatSetOffSync(
  plaidItemId: string,
  { client = defaultClient, startedAt }: { client?: PrismaClient; startedAt: Date },
): Promise<{ trigger: Trigger; triggerAt: Date }> {
  const event = await systemDb(WEBHOOK_WHY, client).plaidWebhookEvent.findFirst({
    where: {
      plaidItemId,
      receivedAt: {
        gte: new Date(startedAt.getTime() - LIVE_WEBHOOK_WINDOW_MINUTES * 60_000),
        lte: startedAt,
      },
    },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  return event
    ? { trigger: "webhook", triggerAt: event.receivedAt }
    : { trigger: "sync", triggerAt: startedAt };
}
