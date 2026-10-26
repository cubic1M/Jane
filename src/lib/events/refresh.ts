import {
  EVENT_SOURCE_LABELS,
  EVENT_TYPE_IDS,
  EVENTS_LOCK_SECONDS,
  EVENTS_REFRESH_MINUTES,
  EVENTS_VIEW_GDELT_TYPES,
  PRICE_SHOCKS,
  type EventTypeId,
} from "@/config/events";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { collectEvents, runEventOverlay, type CollectReport, type Options } from "./run";

// Reading the events sources, shared by every caller (founder, 2026-10-26: fresher, never empty).
// The daily cron reads every source; opening the investments page reads them too when the last
// check is older than EVENTS_REFRESH_MINUTES. Only one refresh runs at a time: the first to claim
// the lock (one atomic update of a refresh_locks row) runs, the others skip, and a refresh that
// dies frees the lock after EVENTS_LOCK_SECONDS. Inside a refresh GDELT is asked one request at a
// time, GDELT_SPACING_MS apart, as it asks. A page view asks GDELT about the
// EVENTS_VIEW_GDELT_TYPES least recently checked types, so a few views in a row cover them all.
// No paid service, and no Claude call.

const KEY = "events";

export type RefreshReport = {
  checkedAt: string;
  // Each source's last answer: "ok" or "failed".
  sources: Record<string, "ok" | "failed">;
  // When each GDELT event type was last asked about.
  gdeltAt: Partial<Record<EventTypeId, string>>;
  found: number;
  stored: number;
};

export type RefreshResult =
  { ran: true; report: RefreshReport } | { ran: false; why: "fresh" | "locked" };

type RefreshOptions = Options & { force?: boolean };

// The last report, for the box: when it last checked and how each source answered.
export async function lastRefresh({
  client = defaultClient,
}: { client?: PrismaClient } = {}): Promise<RefreshReport | null> {
  const row = await client.refreshLock.findUnique({ where: { key: KEY } });
  const report = (row?.report ?? {}) as Partial<RefreshReport>;
  return row?.lastRunAt && report.checkedAt ? (report as RefreshReport) : null;
}

// The GDELT types to ask about: all of them, or the `count` least recently asked.
export function stalestTypes(
  gdeltAt: Partial<Record<EventTypeId, string>>,
  count: number,
): EventTypeId[] {
  return [...EVENT_TYPE_IDS]
    .sort((a, b) => (gdeltAt[a] ?? "").localeCompare(gdeltAt[b] ?? ""))
    .slice(0, count);
}

export async function refreshEvents(options: RefreshOptions = {}): Promise<RefreshResult> {
  const client = options.client ?? defaultClient;
  const now = options.now ?? new Date();
  const force = options.force === true;
  await client.$executeRaw`
    INSERT INTO refresh_locks (key, report) VALUES (${KEY}, '{}'::jsonb) ON CONFLICT (key) DO NOTHING`;
  const freshSince = new Date(now.getTime() - EVENTS_REFRESH_MINUTES * 60_000);
  const lockUntil = new Date(now.getTime() + EVENTS_LOCK_SECONDS * 1000);
  // The claim: one atomic update, so of two at once only one gets the row.
  const claimed = await client.$executeRaw`
    UPDATE refresh_locks SET locked_until = ${lockUntil}
    WHERE key = ${KEY}
      AND (locked_until IS NULL OR locked_until < ${now})
      AND (${force} OR last_run_at IS NULL OR last_run_at < ${freshSince})`;
  if (claimed === 0) {
    const row = await client.refreshLock.findUnique({ where: { key: KEY } });
    return {
      ran: false,
      why: row?.lockedUntil && row.lockedUntil >= now ? "locked" : "fresh",
    };
  }
  const before = (await lastRefresh({ client }))?.gdeltAt ?? {};
  const types = force ? EVENT_TYPE_IDS : stalestTypes(before, EVENTS_VIEW_GDELT_TYPES);
  let collected: CollectReport | null = null;
  try {
    collected = await collectEvents({ ...options, client, now, types });
  } finally {
    const failed = new Set(collected?.failed ?? Object.keys(EVENT_SOURCE_LABELS));
    const sources: Record<string, "ok" | "failed"> = {
      gdelt: [...failed].some((f) => f.startsWith("gdelt:")) ? "failed" : "ok",
      fed: failed.has("fed") ? "failed" : "ok",
      bls_cpi: failed.has("bls_cpi") ? "failed" : "ok",
      eia: failed.has("eia") ? "failed" : "ok",
      headlines: "ok",
      // Failed only when no price check answered (the sample prices have no bitcoin, say).
      prices:
        [...failed].filter((f) => f.startsWith("prices:")).length >= PRICE_SHOCKS.length
          ? "failed"
          : "ok",
    };
    const gdeltAt = { ...before };
    for (const t of collected?.gdelt ?? [])
      if (!failed.has(`gdelt:${t}`)) gdeltAt[t] = now.toISOString();
    const report: RefreshReport = {
      checkedAt: now.toISOString(),
      sources,
      gdeltAt,
      found: collected?.found ?? 0,
      stored: collected?.stored ?? 0,
    };
    await client.refreshLock.update({
      where: { key: KEY },
      data: {
        lockedUntil: null,
        lastRunAt: now,
        report: report as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return { ran: true, report: (await lastRefresh({ client }))! };
}

// Opening the investments page: a refresh when the last one is older than EVENTS_REFRESH_MINUTES
// (or there never was one, so the box isn't blank until the cron), and never an error for the page.
export async function refreshEventsIfStale(
  options: Options & { env?: Record<string, string | undefined> } = {},
): Promise<RefreshResult | null> {
  // The end-to-end tests read seeded events only: no live source is asked from a page there.
  if ((options.env ?? process.env).EVENTS_REFRESH === "off") return null;
  try {
    return await refreshEvents(options);
  } catch (error) {
    console.error("Refreshing events failed", { error: String(error) });
    return null;
  }
}

// Vercel Cron: today's events from every source, then every paper account with the overlay on (all
// but those switched off), one at a time; one failing stops none.
export async function runEventsForAll({
  client = defaultClient,
  now = new Date(),
  ...rest
}: Options = {}) {
  const collected = await refreshEvents({ ...rest, client, now, force: true }).catch((error) => {
    console.error("Collecting events failed", { error: String(error) });
    return null;
  });
  // Every paper account but those switched off (on by default).
  const overlays = await client.paperAccount.findMany({
    where: { NOT: { eventOverlay: { is: { on: false } } } },
    select: { userId: true },
  });
  let ran = 0;
  let failed = 0;
  for (const { userId } of overlays) {
    try {
      if ((await runEventOverlay(userId, { client, now, ...rest })).ran) ran += 1;
    } catch (error) {
      failed += 1;
      console.error("An events overlay run failed", { error: String(error) });
    }
  }
  return { collected, overlays: overlays.length, ran, failed };
}
