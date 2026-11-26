import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The night inside its limit, and how it reports its bank syncs. Every step is a stand-in.

const order = vi.hoisted(() => [] as string[]);
const items = vi.hoisted(() => [] as { id: string }[]);
const stand = vi.hoisted(
  () =>
    (name: string, result: unknown = {}) =>
      vi.fn(async () => {
        order.push(name);
        return result;
      }),
);

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/system-db", () => ({
  systemDb: () => ({
    plaidItem: {
      findMany: async () => {
        order.push("banks");
        return items;
      },
    },
  }),
}));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn(), ITEM_STATUS: { active: "active" } }));
vi.mock("@/lib/robinhood/refresh", () => ({ refreshAllRobinhood: stand("robinhood") }));
vi.mock("@/lib/plaid/inactive", () => ({
  runInactiveCleanup: stand("inactive", { warned: 0, removed: 0, failed: 0 }),
}));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
  reportMissedJobs: vi.fn(async () => []),
}));
vi.mock("@/lib/ops-switches", () => ({ freshSwitches: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ runDueJobs: stand("jobs") }));
vi.mock("@/lib/agent/run", () => ({ runAgentFollowUps: stand("agent") }));
vi.mock("@/lib/merchant-outcomes", () => ({ refreshMerchantOutcomes: stand("outcomes") }));
vi.mock("@/lib/retention", () => ({ runRetention: stand("retention") }));
vi.mock("@/lib/trial-delete", () => ({ deleteTrialsPastTheirTime: stand("trials") }));
vi.mock("@/lib/error-alerts", () => ({ alertError: vi.fn(async () => true) }));
vi.mock("@/lib/learning", () => ({ refreshKindStats: stand("learning") }));
vi.mock("@/lib/evidence/backfill", () => ({ forgetRemovedDemoBanks: stand("demoCleanup") }));
vi.mock("@/lib/import/background", () => ({ refreshAfterRemoval: vi.fn() }));
vi.mock("@/lib/evidence/orphans", () => ({ removeAllOrphans: stand("orphans") }));
vi.mock("@/lib/deadlines", () => ({ remindAllDeadlines: stand("deadlines") }));
vi.mock("@/lib/insurance/daily", () => ({ insuranceDaily: stand("insurance") }));
vi.mock("@/lib/investments/hsa", () => ({ collectAllReceipts: stand("hsaReceipts") }));
vi.mock("@/lib/investments/short-term", () => ({ settleAllLadders: stand("ladders") }));
vi.mock("@/lib/investments/old-accounts", () => ({ settleAllRollovers: stand("rollovers") }));
vi.mock("@/lib/investments/automatic", () => ({
  runAutomaticInvestingForAll: stand("automaticInvesting"),
}));
vi.mock("@/lib/crypto/crypto", () => ({ syncAllCrypto: stand("crypto") }));
vi.mock("@/lib/investments/prices", () => ({ refreshDemoPrices: stand("prices") }));
vi.mock("@/lib/investments/auto-invest", () => ({ runAutoInvestForAll: stand("autoInvest") }));
vi.mock("@/lib/snapshots", () => ({ takeSnapshots: stand("snapshots") }));
vi.mock("@/lib/controller", () => ({ queueNightlyRuns: stand("controller") }));

import { alertError } from "@/lib/error-alerts";
import { syncItem } from "@/lib/plaid/sync";
import { takeSnapshots } from "@/lib/snapshots";
import { GET, maxDuration } from "./route";

const call = () =>
  GET(
    new Request("http://localhost/api/cron/plaid-sync", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
const never = () => new Promise<never>(() => {});

// Runs the night on a clock that only moves when told, up to the function's limit.
async function nightWithinItsLimit() {
  const ended = vi.fn<(how: { body?: Record<string, unknown>; error?: Error }) => void>();
  call().then(
    async (response) => ended({ body: await response.json() }),
    (error: Error) => ended({ error }),
  );
  await vi.advanceTimersByTimeAsync(maxDuration * 1000 - 1000);
  expect(ended).toHaveBeenCalledTimes(1);
  return ended.mock.calls[0]![0];
}

describe("the night's bank syncs and its limit", () => {
  beforeEach(() => {
    order.length = 0;
    items.splice(0, items.length, { id: "a" }, { id: "b" });
    vi.mocked(syncItem).mockReset();
    vi.mocked(alertError).mockClear();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("PLAID_CLIENT_ID", "client");
    vi.stubEnv("PLAID_SECRET", "secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("ends as failed when every bank sync failed, after the other steps ran", async () => {
    vi.mocked(syncItem).mockRejectedValue(new Error("bank down"));
    await expect(call()).rejects.toThrow("Nightly steps failed: banks (2 of 2 bank syncs failed)");
    expect(order).toEqual(expect.arrayContaining(["snapshots", "deadlines", "controller"]));
    expect(alertError).toHaveBeenCalledWith(
      { message: "BankSyncsFailed: every bank sync failed", path: "/api/cron/plaid-sync/banks" },
      { pastCeiling: true },
    );
  });

  it("stays ok when only some failed, and says how many", async () => {
    vi.mocked(syncItem).mockRejectedValueOnce(new Error("bank down"));
    const body = await (await call()).json();
    expect(body).toMatchObject({ synced: 1, failed: 1 });
  });

  it("leaves a bank sync that never answers for tomorrow, and runs the rest", async () => {
    vi.useFakeTimers();
    vi.mocked(syncItem).mockImplementation(never);
    const { body } = await nightWithinItsLimit();
    expect(body).toMatchObject({ synced: 0, failed: 0, deferred: 2 });
    expect(order).toEqual(expect.arrayContaining(["snapshots", "deadlines", "controller"]));
  });

  it("stops waiting for a step that never ends, starts no more, and says which", async () => {
    vi.useFakeTimers();
    vi.mocked(takeSnapshots).mockImplementationOnce(never);
    const { error } = await nightWithinItsLimit();
    expect(error?.message).toMatch(/snapshots \(out of time\)/);
    expect(error?.message).toMatch(/controller \(not started\)/);
    expect(order).not.toContain("deadlines");
    expect(order).not.toContain("controller");
    expect(alertError).toHaveBeenCalledWith(
      {
        message: "OutOfTime: nightly step failed",
        path: "/api/cron/plaid-sync/snapshots",
      },
      { pastCeiling: true },
    );
  });
});
