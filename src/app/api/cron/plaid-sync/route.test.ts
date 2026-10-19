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
vi.mock("@/lib/investments/prices", () => ({
  refreshDemoPrices: vi.fn(async () => ({ refreshed: 1, failed: 0 })),
}));
vi.mock("@/lib/investments/auto-invest", () => ({
  runAutoInvestForAll: vi.fn(async () => ({ invested: 1, paused: 0, failed: 0 })),
}));
vi.mock("@/lib/snapshots", () => ({
  takeSnapshots: vi.fn(async () => ({ saved: 3, removed: 0 })),
}));

import { syncItem } from "@/lib/plaid/sync";
import { GET } from "./route";

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

  it("syncs active items not synced in the last day, and keeps going past failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(syncItem).mockRejectedValueOnce(new Error("bank down"));

    const response = await call("Bearer cron-secret");

    expect(await response.json()).toEqual({
      synced: 1,
      failed: 1,
      inactive: { warned: 0, removed: 1, failed: 0 },
      snapshots: { saved: 3, removed: 0 },
      jobs: { done: 1, retried: 0, failed: 0 },
      agent: { checked: 0 },
      outcomes: { merchants: 2 },
      retention: { rateLimits: 4 },
      deadlines: { users: 2, raised: 1, failed: 0 },
      // Spec step 104: insurance reshopped by itself.
      insurance: { reshop: { people: 1, shops: 1 }, checkups: { people: 1, checkups: 0 } },
      autoInvest: { invested: 1, paused: 0, failed: 0 },
      prices: { refreshed: 1, failed: 0 },
      hsaReceipts: { people: 1, saved: 2 },
    });
    expect(syncItem).toHaveBeenCalledWith("a");
    expect(syncItem).toHaveBeenCalledWith("b");
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
    expect(where.OR[0]).toEqual({ lastSyncedAt: null });
  });

  it("still snapshots balances when Plaid isn't set up", async () => {
    vi.stubEnv("PLAID_SECRET", "");
    expect(await (await call("Bearer cron-secret")).json()).toEqual({
      synced: 0,
      failed: 0,
      inactive: null,
      snapshots: { saved: 3, removed: 0 },
      jobs: { done: 1, retried: 0, failed: 0 },
      agent: { checked: 0 },
      outcomes: { merchants: 2 },
      retention: { rateLimits: 4 },
      deadlines: { users: 2, raised: 1, failed: 0 },
      // Spec step 104: insurance reshopped by itself.
      insurance: { reshop: { people: 1, shops: 1 }, checkups: { people: 1, checkups: 0 } },
      autoInvest: { invested: 1, paused: 0, failed: 0 },
      prices: { refreshed: 1, failed: 0 },
      hsaReceipts: { people: 1, saved: 2 },
    });
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("records the run, and checks the other daily jobs first", async () => {
    const { recordRun, reportMissedJobs } = await import("@/lib/health");
    await call("Bearer cron-secret");
    expect(reportMissedJobs).toHaveBeenCalled();
    expect(recordRun).toHaveBeenCalledWith("plaid-sync", expect.any(Function));
  });
});
