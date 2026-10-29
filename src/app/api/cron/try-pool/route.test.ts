import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/trial-pool", () => ({ fillTrialPool: vi.fn(async () => 2) }));

import { recordRun } from "@/lib/health";
import { fillTrialPool } from "@/lib/trial-pool";
import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/try-pool", {
      headers: authorization ? { authorization } : {},
    }),
  );

// The daily top-up of sample people kept ready for the /try link.
describe("GET /api/cron/try-pool", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.mocked(fillTrialPool).mockClear();
  });

  it("refuses without the cron secret, or when none is configured", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(fillTrialPool).not.toHaveBeenCalled();
  });

  it("tops up the pool and records the run", async () => {
    const response = await call("Bearer cron-secret");
    expect(await response.json()).toEqual({ made: 2 });
    expect(fillTrialPool).toHaveBeenCalledOnce();
    expect(recordRun).toHaveBeenCalledWith("try-pool", expect.any(Function));
  });
});

it("is scheduled daily in vercel.json", async () => {
  const { readFileSync } = await import("node:fs");
  const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons as {
    path: string;
    schedule: string;
  }[];
  expect(crons).toContainEqual({ path: "/api/cron/try-pool", schedule: "0 13 * * *" });
});
