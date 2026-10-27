import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JOB_MAX_ATTEMPTS, JOB_STUCK_MINUTES } from "@/config/jobs";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { backoffMs, enqueueJob, retryJob, runDueJobs, runJob, type Handlers } from "./jobs";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Jobs here run "in the future" (year 2100) so other tests' jobs are never picked up, and
// this file's jobs are never due for anyone else.
const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2100-01-01T00:00:00Z");
const MINUTE = 60 * 1000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

describe.runIf(url)("the job queue against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  const queue = async (userId = "u-jobs") => {
    const id = await enqueueJob("explain_findings", { userId }, { client, now: at(0) });
    ids.push(id);
    return id;
  };
  const job = (id: string) => client.job.findUniqueOrThrow({ where: { id } });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.job.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("runs a job and marks it done", async () => {
    const handler = vi.fn(async () => undefined);
    const id = await queue();
    expect(await runJob(id, { client, now: at(0), handlers: { explain_findings: handler } })).toBe(
      "done",
    );
    expect(handler).toHaveBeenCalledWith({ userId: "u-jobs" });
    expect(await job(id)).toMatchObject({ status: "done", attempts: 1, lastError: null });
  });

  it("retries a failure with a growing wait, then gives up and shows the error", async () => {
    const failing: Handlers = {
      explain_findings: async () => {
        throw new Error("Claude timed out for jordan@example.com");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await queue();

    expect(await runJob(id, { client, now: at(0), handlers: failing })).toBe("retried");
    let row = await job(id);
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(row.runAt).toEqual(new Date(at(0).getTime() + backoffMs(1)));
    // The stored error has personal data scrubbed out.
    expect(row.lastError).not.toContain("jordan@example.com");

    // Not due yet: nothing happens.
    expect(await runJob(id, { client, now: at(0), handlers: failing })).toBe("not_due");

    let now = row.runAt;
    for (let attempt = 2; attempt <= JOB_MAX_ATTEMPTS; attempt += 1) {
      await runJob(id, { client, now, handlers: failing });
      row = await job(id);
      now = row.runAt;
    }
    expect(row).toMatchObject({ status: "failed", attempts: JOB_MAX_ATTEMPTS });

    // The team's retry gives it a fresh set of tries.
    expect(await retryJob(id, { client, now: at(10_000) })).toBe(true);
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("waits longer after each failure", () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(3));
    expect(backoffMs(99)).toBe(backoffMs(5));
  });

  it("picks up a job a stopped server left running", async () => {
    const id = await queue();
    await client.job.update({
      where: { id },
      data: { status: "running", attempts: 1, updatedAt: at(0) },
    });
    const handler = vi.fn(async () => undefined);
    // Too soon: it may still be running somewhere.
    await runJob(id, { client, now: at(1), handlers: { explain_findings: handler } });
    expect(handler).not.toHaveBeenCalled();

    await runJob(id, {
      client,
      now: at(JOB_STUCK_MINUTES + 1),
      handlers: { explain_findings: handler },
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(await job(id)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("never runs a job twice when two runners start at once", async () => {
    const id = await queue();
    const handler = vi.fn<(payload: { userId: string }) => Promise<void>>(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const handlers = { explain_findings: handler };
    await Promise.all([
      runJob(id, { client, now: at(0), handlers }),
      runJob(id, { client, now: at(0), handlers }),
      runDueJobs({ client, now: at(0), handlers, userIds: ["u-jobs"] }),
    ]);
    expect(handler.mock.calls.filter(([p]) => p.userId === "u-jobs")).toHaveLength(1);
    expect((await job(id)).status).toBe("done");
  });

  it("keeps a run of due jobs to the people it's given", async () => {
    // Year 2100: every job queued by any test file is due, so a run for all would take them.
    const mine = await queue("u-jobs-mine");
    const theirs = await queue("u-jobs-theirs");
    const handler = vi.fn(async () => {});
    await runDueJobs({
      client,
      now: at(0),
      handlers: { explain_findings: handler },
      userIds: ["u-jobs-mine"],
    });
    expect(await job(mine)).toMatchObject({ status: "done", attempts: 1 });
    expect(await job(theirs)).toMatchObject({ status: "queued", attempts: 0 });
    expect(handler.mock.calls).toEqual([[{ userId: "u-jobs-mine" }]]);
  });
});
