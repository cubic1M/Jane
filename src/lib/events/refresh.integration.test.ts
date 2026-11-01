import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  SYSTEM_ACTOR: { type: "system", id: null },
}));

import {
  EVENTS_LOCK_SECONDS,
  EVENTS_REFRESH_MINUTES,
  EVENTS_VIEW_GDELT_TYPES,
  EVENT_TYPE_IDS,
  eventTypesFor,
} from "@/config/events";
import { PrismaClient } from "@/generated/prisma/client";
import type { Bar } from "@/lib/market/types";
import type { PaperPrices } from "@/lib/paper/prices";
import type { Fetcher } from "./gdelt";
import {
  lastRefresh,
  refreshEvents,
  refreshEventsIfStale,
  runEventsForAll,
  stalestTypes,
} from "./refresh";

// The shared events refresh against a real, migrated Postgres, on recorded-shape answers (no
// network): the first view runs it at once; then not again within EVENTS_REFRESH_MINUTES; of two
// at once only one runs (the lock), a lock left by a refresh that died frees itself; a page view
// asks GDELT about a few types, the least recently asked, one request at a time with the spacing
// GDELT asks for; the cron (force) asks about all of them.

const url = process.env.TEST_DATABASE_URL;
// 2029, a year no other test file writes market events in.
const NOW = new Date("2029-10-16T15:00:00Z");
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);
const ownYear = () => ({
  date: { gte: new Date("2029-01-01T00:00:00Z"), lt: new Date("2030-01-01T00:00:00Z") },
});

const quietPrices: PaperPrices = {
  name: "sample",
  real: false,
  closes: async (_t: string, from: string, to: string) => {
    const out: Bar[] = [];
    for (
      let d = Date.parse(`${from}T00:00:00Z`);
      d <= Date.parse(`${to}T00:00:00Z`);
      d += 86_400_000
    )
      out.push({ date: new Date(d).toISOString().slice(0, 10), closeCents: 10_000 });
    return out;
  },
};

// Every source answers, quietly; GDELT's calls are timed, and can be made slow.
function fakeFetcher(delayMs = 0) {
  const gdelt: { at: number; query: string }[] = [];
  const fetcher = vi.fn(async (u: string) => {
    if (u.includes("gdeltproject")) {
      gdelt.push({ at: Date.now(), query: decodeURIComponent(u) });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return { ok: true, status: 200, text: async () => JSON.stringify({ timeline: [] }) };
    }
    return { ok: true, status: 200, text: async () => "<rss><channel></channel></rss>" };
  }) as unknown as Fetcher;
  return { fetcher, gdelt };
}

describe.runIf(url)("the shared events refresh", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(async () => {
    await client.refreshLock.deleteMany({ where: { key: "events" } });
    await client.marketEvent.deleteMany({ where: ownYear() });
  });
  afterAll(async () => {
    await client.refreshLock.deleteMany({ where: { key: "events" } });
    await client.marketEvent.deleteMany({ where: ownYear() });
    await client.$disconnect();
  });

  const run = (now: Date, f = fakeFetcher(), extra: { force?: boolean; spacingMs?: number } = {}) =>
    refreshEvents({ client, now, fetcher: f.fetcher, prices: quietPrices, spacingMs: 0, ...extra });

  it("runs at once the first time, then not again within the hour, and again after it", async () => {
    expect(await lastRefresh({ client })).toBeNull();
    const first = await run(NOW);
    expect(first.ran).toBe(true);
    const report = (await lastRefresh({ client }))!;
    expect(report.checkedAt).toBe(NOW.toISOString());
    expect(Object.values(report.sources).every((s) => s === "ok")).toBe(true);
    expect(await run(minutes(EVENTS_REFRESH_MINUTES - 1))).toEqual({ ran: false, why: "fresh" });
    expect((await run(minutes(EVENTS_REFRESH_MINUTES + 1))).ran).toBe(true);
  });

  it("lets one of two at once run, and the other skip", async () => {
    const slow = fakeFetcher(150);
    const [a, b] = await Promise.all([run(NOW, slow), run(NOW, slow)]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ran)).toEqual({ ran: false, why: "locked" });
    // Only the one that ran asked GDELT.
    expect(slow.gdelt).toHaveLength(EVENTS_VIEW_GDELT_TYPES);
  });

  it("frees a lock left by a refresh that died", async () => {
    await client.refreshLock.create({
      data: { key: "events", lockedUntil: minutes(1), report: {} },
    });
    expect(await run(NOW)).toEqual({ ran: false, why: "locked" });
    expect((await run(new Date(NOW.getTime() + (EVENTS_LOCK_SECONDS + 1) * 1000))).ran).toBe(true);
  });

  it("asks GDELT about a few types on a view, the least recently asked, and all of them for the cron", async () => {
    const one = fakeFetcher();
    await run(NOW, one);
    const asked = (await lastRefresh({ client }))!.gdeltAt;
    expect(Object.keys(asked)).toHaveLength(EVENTS_VIEW_GDELT_TYPES);
    const two = fakeFetcher();
    await run(minutes(EVENTS_REFRESH_MINUTES + 1), two);
    const second = (await lastRefresh({ client }))!.gdeltAt;
    // The next view asked about others first.
    expect(Object.keys(second)).toHaveLength(EVENTS_VIEW_GDELT_TYPES * 2);
    expect(stalestTypes(second, 1)[0]).not.toBe(stalestTypes(asked, 1)[0]);
    const cron = fakeFetcher();
    await run(minutes(EVENTS_REFRESH_MINUTES * 2 + 2), cron, { force: true });
    // Every type's daily count, and the crypto types' hour-by-hour counts too.
    expect(cron.gdelt).toHaveLength(EVENT_TYPE_IDS.length + eventTypesFor("crypto").length);
  });

  it("asks GDELT one request at a time, spaced as it asks", async () => {
    const f = fakeFetcher();
    await run(NOW, f, { spacingMs: 60 });
    const gaps = f.gdelt.slice(1).map((c, i) => c.at - f.gdelt[i].at);
    expect(gaps.length).toBe(EVENTS_VIEW_GDELT_TYPES - 1);
    expect(gaps.every((g) => g >= 55)).toBe(true);
  });

  it("skips a page's refresh when switched off for the end-to-end tests, but not the cron's", async () => {
    const f = fakeFetcher();
    expect(
      await refreshEventsIfStale({
        client,
        now: NOW,
        fetcher: f.fetcher,
        env: { EVENTS_REFRESH: "off" },
      }),
    ).toBeNull();
    expect(f.gdelt).toHaveLength(0);
    expect(await lastRefresh({ client })).toBeNull();
    expect((await run(NOW, f, { force: true })).ran).toBe(true);
  });

  // Debugger 11-01: the daily job ran past Vercel's limit (a 504), so nothing it did was recorded.
  // Out of time, it asks GDELT about no more types and leaves the overlays for the next run.
  it("stops starting work once the cron's time is up, and says what it left", async () => {
    const f = fakeFetcher();
    const out = await runEventsForAll({
      client,
      now: NOW,
      fetcher: f.fetcher,
      prices: quietPrices,
      spacingMs: 0,
      deadline: Date.now() - 1,
    });
    expect(f.gdelt).toHaveLength(0);
    expect(out.ran).toBe(0);
    expect(out.deferred).toBe(out.overlays);
    const report = (await lastRefresh({ client }))!;
    expect(report.sources.gdelt).toBe("failed");
    expect(report.gdeltAt).toEqual({});
  });

  it("never fails the page: an error comes back as nothing", async () => {
    const broken = { ...client, $executeRaw: () => Promise.reject(new Error("down")) };
    expect(
      await refreshEventsIfStale({ client: broken as unknown as PrismaClient, now: NOW }),
    ).toBeNull();
  });
});
