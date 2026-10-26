import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/events/run", () => ({
  runEventsForAll: vi.fn(async () => ({
    collected: { found: 3, stored: 2, failed: [] },
    overlays: 1,
    ran: 1,
    failed: 0,
  })),
}));

import { recordRun } from "@/lib/health";
import { runEventsForAll } from "@/lib/events/run";
import { GET, maxDuration } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/events", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/events", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    vi.mocked(runEventsForAll).mockClear();
  });

  it("refuses without the cron secret, or when none is configured", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(runEventsForAll).not.toHaveBeenCalled();
  });

  it("collects the day's events, runs every overlay that is on, and records the run", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ overlays: 1, ran: 1 });
    expect(vi.mocked(recordRun).mock.calls.at(-1)?.[0]).toBe("events");
  });

  it("is on the daily schedule after the paper accounts' run, with time for GDELT's spacing", () => {
    const crons = JSON.parse(readFileSync("vercel.json", "utf8")).crons as {
      path: string;
      schedule: string;
    }[];
    expect(crons).toContainEqual({ path: "/api/cron/events", schedule: "30 22 * * *" });
    expect(crons).toContainEqual({ path: "/api/cron/paper-run", schedule: "0 22 * * *" });
    expect(maxDuration).toBeGreaterThanOrEqual(120);
  });
});
