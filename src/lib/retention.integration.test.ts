import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETENTION_PERIODS } from "@/config/retention";
import { PrismaClient } from "@/generated/prisma/client";
import { runRetention } from "./retention";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Everything here is dated far in the past (1990) relative to a "now" in 1991, so other
// tests' rows are never near a boundary.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("1991-01-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
// Just past each period, and just inside it.
const old = (days: number) => new Date(NOW.getTime() - days * DAY - 60_000);
const young = (days: number) => new Date(NOW.getTime() - days * DAY + 60_000);

describe.runIf(url)("data retention against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const tag = crypto.randomUUID();

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `retain-${tag}@example.com` } })).id;
    const p = RETENTION_PERIODS;
    for (const [name, at] of [
      [`old-${tag}`, old(p.analyticsEvents.days)],
      [`young-${tag}`, young(p.analyticsEvents.days)],
    ] as const) {
      await client.analyticsEvent.create({ data: { name, createdAt: at } });
    }
    for (const [message, at] of [
      [`old-${tag}`, old(p.errorEvents.days)],
      [`young-${tag}`, young(p.errorEvents.days)],
    ] as const) {
      await client.errorEvent.create({ data: { message, createdAt: at } });
    }
    for (const [kind, status, at] of [
      [`old-${tag}`, "done", old(p.finishedJobs.days)],
      [`young-${tag}`, "done", young(p.finishedJobs.days)],
      [`queued-${tag}`, "queued", old(p.finishedJobs.days)],
    ] as const) {
      await client.job.create({ data: { kind, status, updatedAt: at } });
    }
    for (const [name, at] of [
      [`old-${tag}`, old(p.cronRuns.days)],
      [`young-${tag}`, young(p.cronRuns.days)],
    ] as const) {
      await client.cronRun.create({ data: { name, startedAt: at } });
    }
    // The young window is dated today: rate limiting also clears old windows by the real
    // date now and then (src/lib/rate-limit.ts), which would take one dated near 1991.
    for (const [key, at] of [
      [`old-${tag}`, old(p.rateLimits.days)],
      [`young-${tag}`, new Date()],
    ] as const) {
      await client.rateLimit.create({ data: { key, windowStart: at, count: 1 } });
    }
    // Access-log entries go after their period; other audit entries (consents, decisions) stay.
    for (const [event, targetId, at] of [
      ["user_signed_in", `old-${tag}`, old(p.accessLog.days)],
      ["user_signed_in", `young-${tag}`, young(p.accessLog.days)],
      ["terms_accepted", `kept-${tag}`, old(p.accessLog.days)],
    ] as const) {
      await client.auditLog.create({
        data: {
          actorType: "user",
          actorId: userId,
          event,
          targetType: "test",
          targetId,
          createdAt: at,
        },
      });
    }
    for (const [sessionToken, at] of [
      [`old-${tag}`, old(p.expiredSessions.days)],
      [`young-${tag}`, young(p.expiredSessions.days)],
    ] as const) {
      await client.session.create({ data: { sessionToken, userId, expires: at } });
    }
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.analyticsEvent.deleteMany({ where: { name: { endsWith: tag } } });
    await client.errorEvent.deleteMany({ where: { message: { endsWith: tag } } });
    await client.job.deleteMany({ where: { kind: { endsWith: tag } } });
    await client.cronRun.deleteMany({ where: { name: { endsWith: tag } } });
    await client.rateLimit.deleteMany({ where: { key: { endsWith: tag } } });
    await client.auditLog.deleteMany({ where: { targetId: { endsWith: tag } } });
    await client.$disconnect();
  });

  it("removes each kind after its period and touches nothing younger", async () => {
    await runRetention({ client, now: NOW });

    expect(
      (await client.analyticsEvent.findMany({ where: { name: { endsWith: tag } } })).map(
        (r) => r.name,
      ),
    ).toEqual([`young-${tag}`]);
    expect(
      (await client.errorEvent.findMany({ where: { message: { endsWith: tag } } })).map(
        (r) => r.message,
      ),
    ).toEqual([`young-${tag}`]);
    expect(
      (await client.job.findMany({ where: { kind: { endsWith: tag } } })).map((r) => r.kind).sort(),
    ).toEqual([`queued-${tag}`, `young-${tag}`]);
    expect(
      (await client.cronRun.findMany({ where: { name: { endsWith: tag } } })).map((r) => r.name),
    ).toEqual([`young-${tag}`]);
    expect(
      (await client.rateLimit.findMany({ where: { key: { endsWith: tag } } })).map((r) => r.key),
    ).toEqual([`young-${tag}`]);
    expect(
      (await client.session.findMany({ where: { userId } })).map((r) => r.sessionToken),
    ).toEqual([`young-${tag}`]);
    expect(
      (await client.auditLog.findMany({ where: { targetId: { endsWith: tag } } }))
        .map((r) => r.targetId)
        .sort(),
    ).toEqual([`kept-${tag}`, `young-${tag}`]);
  });
});
