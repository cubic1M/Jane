import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/investments/strategy-eval", () => ({
  runStrategyEvaluation: vi.fn(async () => ({ ran: false, why: "Not yet." })),
}));

import { recordRun } from "@/lib/health";
import { runStrategyEvaluation } from "@/lib/investments/strategy-eval";
import { GET } from "./route";

// The weekly strategy evaluation: only Vercel Cron (with the secret) can run it, and it is on
// the schedule, after the daily history load.

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/strategy-eval", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/strategy-eval", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
  });

  it("refuses without the cron secret, or when none is configured", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(runStrategyEvaluation).not.toHaveBeenCalled();
  });

  it("runs the evaluation and records the run", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ran: false, why: "Not yet." });
    expect(recordRun).toHaveBeenCalledWith("strategy-eval", expect.any(Function));
  });

  it("is scheduled weekly, after the daily history load", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const job = config.crons.find((c) => c.path === "/api/cron/strategy-eval");
    const load = config.crons.find((c) => c.path === "/api/cron/market-history");
    expect(job?.schedule).toMatch(/^\d+ \d+ \* \* [0-6]$/);
    expect(Number(job!.schedule.split(" ")[1])).toBeGreaterThan(
      Number(load!.schedule.split(" ")[1]),
    );
  });
});
