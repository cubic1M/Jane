import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/practice/scan", () => ({
  runPracticeDayForAll: vi.fn(async () => ({ portfolios: 2, flags: 3, trades: 4, failed: 0 })),
}));

import { recordRun } from "@/lib/health";
import { runPracticeDayForAll } from "@/lib/practice/scan";
import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/practice-scan", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/practice-scan", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
  });

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runPracticeDayForAll).not.toHaveBeenCalled();
  });

  it("refuses when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
  });

  it("scans every practice portfolio and records the run", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ portfolios: 2, flags: 3, trades: 4, failed: 0 });
    expect(recordRun).toHaveBeenCalledWith("practice-scan", expect.any(Function));
  });
});
