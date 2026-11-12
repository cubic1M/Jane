import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/invariants/accuracy", () => ({
  ACCURACY_JOB: "accuracy",
  runAccuracyChecks: vi.fn(),
}));

import { recordRun } from "@/lib/health";
import { runAccuracyChecks } from "@/lib/invariants/accuracy";
import { GET, maxDuration } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/accuracy", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/accuracy", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.mocked(runAccuracyChecks).mockReset();
  });

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runAccuracyChecks).not.toHaveBeenCalled();
  });

  it("runs the checks as a recorded daily job and answers with the counts", async () => {
    const summary = {
      people: 3,
      checked: 3,
      notChecked: 0,
      errored: 0,
      checks: [{ name: "no_future_transactions", passed: 90, failed: 1, notApplicable: 0 }],
      failing: ["no_future_transactions"],
    };
    vi.mocked(runAccuracyChecks).mockResolvedValue(summary as never);
    const response = await call("Bearer cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(recordRun).toHaveBeenCalledWith("accuracy", expect.any(Function));
    // The run's own budget fits inside the function's limit.
    expect(maxDuration).toBe(300);
  });
});
