import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/offers/catalog", () => ({
  refreshDueOffers: vi.fn(async () => [
    { source: "barclays.savings", changed: ["savings.barclays"], quarantined: [], missing: [] },
    { source: "spotify.plans", changed: [], quarantined: ["plan.spotify.student"], missing: [] },
  ]),
}));

vi.mock("@/lib/live/watches", () => ({
  matchOffers: vi.fn(async () => ({ matched: 3, left: 0 })),
}));

import { recordRun } from "@/lib/health";
import { refreshDueOffers } from "@/lib/offers/catalog";
import { GET } from "./route";

// The offers catalog's refresher: the hourly call from the probe's workflow (PROBE_SECRET) and Vercel's
// daily backstop (CRON_SECRET) both reach it; nobody else does.

const call = (authorization?: string) =>
  GET(
    new Request("https://jane.test/api/cron/offers", {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "daily");
  vi.stubEnv("PROBE_SECRET", "hourly");
});
afterEach(() => vi.unstubAllEnvs());

describe("the offers refresher", () => {
  it("refuses a call without either secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(refreshDueOffers).not.toHaveBeenCalled();
  });

  it("runs for the hourly call and the daily one, as a recorded job", async () => {
    for (const secret of ["hourly", "daily"]) {
      const response = await call(`Bearer ${secret}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sources: 2,
        changed: 1,
        quarantined: 1,
        matched: 3,
        left: 0,
      });
    }
    expect(recordRun).toHaveBeenCalledWith("offers", expect.any(Function));
    expect(refreshDueOffers).toHaveBeenCalledTimes(2);
  });

  it("refuses everyone while neither secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("PROBE_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });
});
