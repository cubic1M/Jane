import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_STALE_HOURS } from "@/config/health";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { healthReport, jobHealth, recordRun, reportMissedJobs } from "./health";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Cron runs are global, so this file works far in the future (2200) and cleans up after.
const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2200-01-01T00:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

describe.runIf(url)("health checks against a real database", () => {
  let client: PrismaClient;
  const send = vi.fn();

  beforeAll(() => {
    vi.stubEnv("ADMIN_EMAILS", "ana@example.com, sam@example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(async () => {
    send.mockReset().mockResolvedValue(undefined);
    await client.cronRun.deleteMany({ where: { startedAt: { gte: T0 } } });
    await client.healthNotice.deleteMany({});
  });
  afterAll(async () => {
    await client.cronRun.deleteMany({ where: { startedAt: { gte: T0 } } });
    await client.healthNotice.deleteMany({});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("records a good run with its summary, and a failed one with its error", async () => {
    expect(
      await recordRun("digest", async () => ({ sent: 3 }), { client, now: () => at(0) }),
    ).toEqual({
      sent: 3,
    });
    await expect(
      recordRun(
        "digest",
        async () => {
          throw new Error("Resend down for jordan@example.com");
        },
        { client, now: () => at(1) },
      ),
    ).rejects.toThrow("Resend down");

    const runs = await client.cronRun.findMany({
      where: { name: "digest", startedAt: { gte: T0 } },
      orderBy: { startedAt: "asc" },
    });
    expect(runs.map((r) => [r.ok, r.summary])).toEqual([
      [true, { sent: 3 }],
      [false, null],
    ]);
    expect(runs[1].error).not.toContain("jordan@example.com");
  });

  it("reports a missed daily job once per outage, to each person on the team", async () => {
    await recordRun("digest", async () => null, { client, now: () => at(0) });
    await recordRun("plaid-sync", async () => null, { client, now: () => at(JOB_STALE_HOURS + 1) });

    const later = at(JOB_STALE_HOURS + 2);
    expect(await reportMissedJobs({ client, now: later, send })).toEqual(["digest"]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([m]) => m.to).sort()).toEqual([
      "ana@example.com",
      "sam@example.com",
    ]);

    // An hour later: still down, but already reported.
    expect(await reportMissedJobs({ client, now: at(JOB_STALE_HOURS + 3), send })).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);

    // It runs again, then stops again: that's a new outage, reported again.
    await recordRun("digest", async () => null, { client, now: () => at(JOB_STALE_HOURS + 4) });
    expect(await reportMissedJobs({ client, now: at(2 * JOB_STALE_HOURS + 6), send })).toContain(
      "digest",
    );
  });

  it("calls a job missed that has failed for longer than that without ever succeeding", async () => {
    const fail = async () => {
      throw new Error("Alpaca refused");
    };
    await expect(recordRun("paper-run", fail, { client, now: () => at(0) })).rejects.toThrow();
    await expect(recordRun("paper-run", fail, { client, now: () => at(20) })).rejects.toThrow();
    // Not yet a day of trying: not missed.
    expect(
      (await jobHealth({ client, now: at(10) })).find((j) => j.name === "paper-run"),
    ).toMatchObject({ missed: false, lastSuccessAt: null });
    const later = at(JOB_STALE_HOURS + 1);
    expect(
      (await jobHealth({ client, now: later })).find((j) => j.name === "paper-run"),
    ).toMatchObject({ missed: true, lastOk: false });
    expect(await reportMissedJobs({ client, now: later, send })).toContain("paper-run");
    const subjects = send.mock.calls.map(([m]) => m.subject);
    expect(subjects).toContain('Daily job "paper-run" has never run successfully');
  });

  it("doesn't call a job that has never run missed", async () => {
    const jobs = await jobHealth({ client, now: at(1000) });
    expect(jobs.every((j) => !j.missed)).toBe(true);
  });

  it("audit-logs every view of the health page", async () => {
    const report = await healthReport({ id: "admin_1" }, { client, now: at(0) });
    // Every daily job the founder named (2026-10-26).
    expect(report.jobs.map((j) => j.name)).toEqual([
      "plaid-sync",
      "digest",
      "market-history",
      "paper-run",
      "practice-scan",
      "events",
    ]);
    // And row-level security, whole on a protected database (src/lib/rls-coverage.ts).
    expect(report.rls).toMatchObject({ role: true, missing: [], ok: true, switchWorks: true });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "admin_viewed_health",
      null,
      {},
    );
  });
});
