import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => {}) }));
vi.mock("@/lib/gmail/sync", () => ({
  refreshAllGmail: vi.fn(async () => ({
    read: 3,
    waiting: 1,
    failed: 1,
    reconnect: 0,
    deferred: 2,
  })),
}));

import { GMAIL_LIMITS } from "@/config/gmail";
import { refreshAllGmail } from "@/lib/gmail/sync";
import { recordRun } from "@/lib/health";
import { freshSwitches } from "@/lib/ops-switches";
import { GET, maxDuration } from "./route";

// The Gmail mailboxes' daily job: Vercel's cron reaches it with CRON_SECRET, and nobody else does.

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/gmail", {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/gmail", () => {
  it("refuses without the cron secret, or when none is set, and reads nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(refreshAllGmail).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("reads the mailboxes due, inside the job's budget, as a recorded run, and answers with the counts", async () => {
    const response = await call("Bearer cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      read: 3,
      waiting: 1,
      failed: 1,
      reconnect: 0,
      deferred: 2,
    });
    expect(recordRun).toHaveBeenCalledWith("gmail", expect.any(Function));
    expect(refreshAllGmail).toHaveBeenCalledWith({ budgetMs: GMAIL_LIMITS.cronBudgetMs });
  });

  it("brings the emergency switches up to date before it reads anything", async () => {
    await call("Bearer cron-secret");
    const [switches] = vi.mocked(freshSwitches).mock.invocationCallOrder;
    const [reading] = vi.mocked(refreshAllGmail).mock.invocationCallOrder;
    expect(switches).toBeLessThan(reading);
  });

  it("says it's off when mailboxes are switched off or paused", async () => {
    vi.mocked(refreshAllGmail).mockResolvedValueOnce(null);
    const response = await call("Bearer cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ off: true });
    expect(recordRun).toHaveBeenCalledWith("gmail", expect.any(Function));
  });

  it("is on the daily schedule, at a minute of its own", () => {
    const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons as {
      path: string;
      schedule: string;
    }[];
    expect(crons).toContainEqual({ path: "/api/cron/gmail", schedule: "15 11 * * *" });
    expect(crons.filter((cron) => cron.schedule === "15 11 * * *")).toHaveLength(1);
  });

  // A mailbox may start just before the job's budget ends, with a budget of its own, and the calls
  // it is in when that ends still run their course: two to Google with every retry, and Claude's
  // one with its retry. All of it has to end inside Vercel's limit.
  it("stops starting mailboxes in time for the last one to end inside Vercel's limit", () => {
    const { cronBudgetMs, nightMailboxBudgetMs, callTimeoutMs, callRetries, readerTimeoutMs } =
      GMAIL_LIMITS;
    expect(
      cronBudgetMs +
        nightMailboxBudgetMs +
        2 * callTimeoutMs * (1 + callRetries) +
        2 * readerTimeoutMs,
    ).toBeLessThan(maxDuration * 1000);
  });
});
