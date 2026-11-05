import { beforeEach, describe, expect, it, vi } from "vitest";

// One step of the night failing doesn't cost anyone the steps after it, and what the legal pages
// promise runs early. Every step is a stand-in: only their order and failures matter here.

const order = vi.hoisted(() => [] as string[]);
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
        return [];
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
import { refreshKindStats } from "@/lib/learning";
import { runInactiveCleanup } from "@/lib/plaid/inactive";
import { runRetention } from "@/lib/retention";
import { takeSnapshots } from "@/lib/snapshots";
import { GET } from "./route";

const call = () =>
  GET(
    new Request("http://localhost/api/cron/plaid-sync", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );

const AFTER_LEARNING = ["deadlines", "insurance", "rollovers", "ladders", "controller"];

describe("one step of the night failing", () => {
  beforeEach(() => {
    order.length = 0;
    vi.mocked(alertError).mockClear();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("PLAID_CLIENT_ID", "client");
    vi.stubEnv("PLAID_SECRET", "secret");
  });

  it("still runs the steps after it, tells the team at once, and ends the run as failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(refreshKindStats).mockRejectedValueOnce(new RangeError("someone's 2147483648"));

    await expect(call()).rejects.toThrow("Nightly steps failed: learning");

    expect(order).toEqual(expect.arrayContaining(AFTER_LEARNING));
    expect(alertError).toHaveBeenCalledWith(
      { message: "RangeError: nightly step failed", path: "/api/cron/plaid-sync/learning" },
      { pastCeiling: true },
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("2147483648");
  });

  it("deletes what the privacy page promises even when a step before the old place for it fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(takeSnapshots).mockRejectedValueOnce(new Error("boom"));
    await expect(call()).rejects.toThrow("snapshots");
    expect(order).toContain("retention");
  });

  it("deletes before the steps that can use up the night's time", async () => {
    await call();
    const at = (step: string) => order.indexOf(step);
    expect(at("trials")).toBeLessThan(at("retention"));
    for (const later of ["banks", "inactive", "robinhood", "snapshots", "jobs"]) {
      expect(at("retention")).toBeLessThan(at(later));
    }
  });

  it("names every step that failed, and the others' work still ran", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runRetention).mockRejectedValueOnce(new Error("a"));
    vi.mocked(refreshKindStats).mockRejectedValueOnce(new Error("b"));
    await expect(call()).rejects.toThrow("Nightly steps failed: retention, learning");
    expect(order).toEqual(expect.arrayContaining(["banks", "snapshots", ...AFTER_LEARNING]));
  });

  it("tells the team when a bank we said we'd disconnect wasn't", async () => {
    vi.mocked(runInactiveCleanup).mockResolvedValueOnce({ warned: 0, removed: 0, failed: 1 });
    await call();
    expect(alertError).toHaveBeenCalledWith(
      {
        message: "InactiveCleanupFailed: a bank wasn't disconnected",
        path: "/api/cron/plaid-sync/inactive",
      },
      { pastCeiling: true },
    );
  });
});
