import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { plaidItem: { findMany } } }));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn(), ITEM_STATUS: { active: "active" } }));
vi.mock("@/lib/plaid/inactive", () => ({
  runInactiveCleanup: vi.fn(async () => ({ warned: 0, removed: 1, failed: 0 })),
}));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
  reportMissedJobs: vi.fn(async () => []),
}));
vi.mock("@/lib/jobs", () => ({
  runDueJobs: vi.fn(async () => ({ done: 1, retried: 0, failed: 0 })),
}));
vi.mock("@/lib/agent/run", () => ({ runAgentFollowUps: vi.fn(async () => ({ checked: 0 })) }));
vi.mock("@/lib/merchant-outcomes", () => ({
  refreshMerchantOutcomes: vi.fn(async () => ({ merchants: 2 })),
}));
vi.mock("@/lib/retention", () => ({ runRetention: vi.fn(async () => ({ rateLimits: 4 })) }));
vi.mock("@/lib/learning", () => ({ refreshKindStats: vi.fn(async () => 3) }));
vi.mock("@/lib/evidence/backfill", () => ({
  forgetRemovedDemoBanks: vi.fn(async () => ({ forgotten: 0, failed: 0 })),
}));
vi.mock("@/lib/import/background", () => ({ refreshAfterRemoval: vi.fn() }));
vi.mock("@/lib/evidence/orphans", () => ({
  removeAllOrphans: vi.fn(async () => ({
    users: 0,
    removed: { findings: 0, outcomes: 0, alerts: 0 },
    failed: 0,
  })),
}));
vi.mock("@/lib/deadlines", () => ({
  remindAllDeadlines: vi.fn(async () => ({ users: 2, raised: 1, failed: 0 })),
}));
vi.mock("@/lib/insurance/daily", () => ({
  insuranceDaily: vi.fn(async () => ({
    reshop: { people: 1, shops: 1 },
    checkups: { people: 1, checkups: 0 },
  })),
}));
vi.mock("@/lib/investments/hsa", () => ({
  collectAllReceipts: vi.fn(async () => ({ people: 1, saved: 2 })),
}));
vi.mock("@/lib/investments/short-term", () => ({
  settleAllLadders: vi.fn(async () => ({ people: 1, rolled: 2 })),
}));
vi.mock("@/lib/investments/old-accounts", () => ({
  settleAllRollovers: vi.fn(async () => ({ people: 1, done: 1 })),
}));
vi.mock("@/lib/investments/automatic", () => ({
  runAutomaticInvestingForAll: vi.fn(async () => ({ people: 1, acted: 2 })),
}));
vi.mock("@/lib/crypto/crypto", () => ({
  syncAllCrypto: vi.fn(async () => ({ people: 1, synced: 1 })),
}));
vi.mock("@/lib/investments/prices", () => ({
  refreshDemoPrices: vi.fn(async () => ({ refreshed: 1, failed: 0 })),
}));
vi.mock("@/lib/investments/auto-invest", () => ({
  runAutoInvestForAll: vi.fn(async () => ({ invested: 1, paused: 0, failed: 0 })),
}));
vi.mock("@/lib/snapshots", () => ({
  takeSnapshots: vi.fn(async () => ({ saved: 3, removed: 0 })),
}));

vi.mock("@/lib/controller", () => ({
  queueNightlyRuns: vi.fn(async () => ({ queued: 3, done: 3 })),
}));

import { queueNightlyRuns } from "@/lib/controller";
import { syncItem } from "@/lib/plaid/sync";
import { runDueJobs } from "@/lib/jobs";
import { CRON_SYNC_BUDGET_MS } from "@/config/plaid";
import { CONTROLLER_CRON_BUDGET_MS, CONTROLLER_RUN_RESERVE_MS } from "@/config/controller";
import { GET, maxDuration } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/plaid-sync", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/plaid-sync", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("PLAID_CLIENT_ID", "client");
    vi.stubEnv("PLAID_SECRET", "secret");
    findMany.mockReset().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    vi.mocked(syncItem).mockReset();
  });

  it("refuses calls without Vercel's cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  // The backstop for a missed webhook (webhooks sync as soon as Plaid has news): items not synced
  // in 20 hours, so one synced a little after yesterday's run isn't skipped for two days.
  it("syncs active items not synced in 20 hours, and keeps going past failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(syncItem).mockRejectedValueOnce(new Error("bank down"));

    const response = await call("Bearer cron-secret");

    expect(await response.json()).toEqual({
      synced: 1,
      failed: 1,
      deferred: 0,
      inactive: { warned: 0, removed: 1, failed: 0 },
      snapshots: { saved: 3, removed: 0 },
      jobs: { done: 1, retried: 0, failed: 0 },
      agent: { checked: 0 },
      outcomes: { merchants: 2 },
      retention: { rateLimits: 4 },
      orphans: { users: 0, removed: { findings: 0, outcomes: 0, alerts: 0 }, failed: 0 },
      demoCleanup: { forgotten: 0, failed: 0 },
      learning: 3,
      deadlines: { users: 2, raised: 1, failed: 0 },
      // Spec step 104: insurance reshopped by itself.
      insurance: { reshop: { people: 1, shops: 1 }, checkups: { people: 1, checkups: 0 } },
      autoInvest: { invested: 1, paused: 0, failed: 0 },
      controller: { queued: 3, done: 3 },
      prices: { refreshed: 1, failed: 0 },
      hsaReceipts: { people: 1, saved: 2 },
      crypto: { people: 1, synced: 1 },
      automaticInvesting: { people: 1, acted: 2 },
      rollovers: { people: 1, done: 1 },
      ladders: { people: 1, rolled: 2 },
    });
    expect(syncItem).toHaveBeenCalledWith("a");
    expect(syncItem).toHaveBeenCalledWith("b");
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
    expect(where.OR[0]).toEqual({ lastSyncedAt: null });
    const cutoff = where.OR[1].lastSyncedAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(20 * 60 * 60 * 1000);
    expect(Date.now() - cutoff.getTime()).toBeLessThan(20 * 60 * 60 * 1000 + 60_000);
  });

  it("still snapshots balances when Plaid isn't set up", async () => {
    vi.stubEnv("PLAID_SECRET", "");
    expect(await (await call("Bearer cron-secret")).json()).toEqual({
      synced: 0,
      failed: 0,
      deferred: 0,
      inactive: null,
      snapshots: { saved: 3, removed: 0 },
      jobs: { done: 1, retried: 0, failed: 0 },
      agent: { checked: 0 },
      outcomes: { merchants: 2 },
      retention: { rateLimits: 4 },
      orphans: { users: 0, removed: { findings: 0, outcomes: 0, alerts: 0 }, failed: 0 },
      demoCleanup: { forgotten: 0, failed: 0 },
      learning: 3,
      deadlines: { users: 2, raised: 1, failed: 0 },
      // Spec step 104: insurance reshopped by itself.
      insurance: { reshop: { people: 1, shops: 1 }, checkups: { people: 1, checkups: 0 } },
      autoInvest: { invested: 1, paused: 0, failed: 0 },
      controller: { queued: 3, done: 3 },
      prices: { refreshed: 1, failed: 0 },
      hsaReceipts: { people: 1, saved: 2 },
      crypto: { people: 1, synced: 1 },
      automaticInvesting: { people: 1, acted: 2 },
      rollovers: { people: 1, done: 1 },
      ladders: { people: 1, rolled: 2 },
    });
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("records the run, and checks the other daily jobs first", async () => {
    const { recordRun, reportMissedJobs } = await import("@/lib/health");
    await call("Bearer cron-secret");
    expect(reportMissedJobs).toHaveBeenCalled();
    expect(recordRun).toHaveBeenCalledWith("plaid-sync", expect.any(Function));
  });

  // Debugger 10-31 (production logs): this cron returned 504 and its health check called it
  // and the digest stale for over a day. The nightly controller drained people's runs for up to
  // 240 s inside it, after the other steps and before six more, past the function's limit. It
  // now runs last, with only the time left less one run's worth, and the limit is declared.
  it("gives the controller only the time left, last, inside a declared limit", async () => {
    expect(maxDuration).toBeGreaterThanOrEqual(300);
    vi.mocked(queueNightlyRuns).mockClear();
    const response = await call("Bearer cron-secret");
    const body = await response.json();
    expect(Object.keys(body).at(-1)).toBe("controller");
    const budget = vi.mocked(queueNightlyRuns).mock.calls[0][0]!.budgetMs!;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(
      Math.min(CONTROLLER_CRON_BUDGET_MS, maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS),
    );
  });

  // Debugger 11-01 (production logs): a 504 again at 10:18Z after #1103. The bank syncs ran one
  // after another with no clock (up to CRON_SYNC_LIMIT, each a full rescan), then the due jobs
  // took a fixed minute. The syncs stop at their budget, oldest first, the rest wait for
  // tomorrow; the jobs get no more than the time left.
  it("stops syncing at its budget, leaves the rest for tomorrow, and gives the jobs the time left", async () => {
    let clock = 1_000_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]);
    vi.mocked(syncItem).mockImplementation(async () => {
      clock += 100_000;
      return undefined as never;
    });
    vi.mocked(runDueJobs).mockClear();
    try {
      const body = await (await call("Bearer cron-secret")).json();
      expect(CRON_SYNC_BUDGET_MS).toBeLessThan(maxDuration * 1000);
      expect(body.synced + body.deferred).toBe(4);
      expect(body.deferred).toBeGreaterThan(0);
      const elapsed = body.synced * 100_000;
      expect(elapsed).toBeLessThanOrEqual(CRON_SYNC_BUDGET_MS + 100_000);
      const jobs = vi.mocked(runDueJobs).mock.calls[0][0]!.budgetMs!;
      expect(jobs).toBeLessThanOrEqual(maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS - elapsed);
    } finally {
      now.mockRestore();
    }
  });
});
