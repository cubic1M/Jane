import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ result: { ok: true, checks: [{ name: "a", ok: true }] } }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/error-log", () => ({
  describeError: vi.fn(() => ({ message: "ProbeFailed: a", stack: null, digest: null })),
  recordError: vi.fn(async () => {}),
}));
vi.mock("@/lib/error-alerts", () => ({ alertError: vi.fn(async () => true) }));
vi.mock("@/lib/probe", async (original) => ({
  ...(await original<typeof import("@/lib/probe")>()),
  runProbe: vi.fn(async () => probe.result),
}));

import { alertError } from "@/lib/error-alerts";
import { recordError } from "@/lib/error-log";
import { recordRun } from "@/lib/health";
import { runProbe } from "@/lib/probe";
import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("https://jane.test/api/cron/probe", {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  probe.result = { ok: true, checks: [{ name: "a", ok: true }] };
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/probe", () => {
  it("refuses everyone until PROBE_SECRET is set, and runs nothing", async () => {
    vi.stubEnv("PROBE_SECRET", "");
    for (const header of [undefined, "Bearer ", "Bearer undefined"]) {
      expect((await call(header)).status).toBe(401);
    }
    expect(runProbe).not.toHaveBeenCalled();
  });

  it("refuses the wrong secret, including the cron one", async () => {
    vi.stubEnv("PROBE_SECRET", "right");
    vi.stubEnv("CRON_SECRET", "cron");
    expect((await call("Bearer cron")).status).toBe(401);
    expect(runProbe).not.toHaveBeenCalled();
  });

  it("runs against its own address and reports a pass", async () => {
    vi.stubEnv("PROBE_SECRET", "right");
    const response = await call("Bearer right");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(probe.result);
    expect(runProbe).toHaveBeenCalledWith("https://jane.test");
    expect(recordRun).toHaveBeenCalledWith("probe", expect.any(Function));
    expect(alertError).not.toHaveBeenCalled();
  });

  it("answers 503 on a failed check, records it and tells the team", async () => {
    vi.stubEnv("PROBE_SECRET", "right");
    probe.result = { ok: false, checks: [{ name: "a", ok: false }] };
    const response = await call("Bearer right");
    expect(response.status).toBe(503);
    expect(recordError).toHaveBeenCalledOnce();
    expect(alertError).toHaveBeenCalledOnce();
  });
});
