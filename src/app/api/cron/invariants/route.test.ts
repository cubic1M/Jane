import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/error-alerts", () => ({ alertError: vi.fn(async () => true) }));
vi.mock("@/lib/invariants/nightly", () => ({ runInvariants: vi.fn() }));

import { alertError } from "@/lib/error-alerts";
import { recordRun } from "@/lib/health";
import { runInvariants } from "@/lib/invariants/nightly";
import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/invariants", {
      headers: authorization ? { authorization } : {},
    }),
  );
const summary = (broken: string[]) => ({ people: 2, broken }) as never;

describe("GET /api/cron/invariants", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    vi.mocked(runInvariants).mockReset();
    vi.mocked(alertError).mockClear();
  });

  it("refuses without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runInvariants).not.toHaveBeenCalled();
  });

  it("records the run and stays quiet when everything holds", async () => {
    vi.mocked(runInvariants).mockResolvedValue(summary([]));
    const response = await call("Bearer cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ people: 2, broken: [] });
    expect(recordRun).toHaveBeenCalledWith("invariants", expect.any(Function));
    expect(alertError).not.toHaveBeenCalled();
  });

  it("emails the team the names of what broke, and nothing else", async () => {
    vi.mocked(runInvariants).mockResolvedValue(summary(["negativeSaving"]));
    await call("Bearer cron-secret");
    expect(alertError).toHaveBeenCalledWith(
      { message: "Nightly invariants: negativeSaving", path: "/api/cron/invariants" },
      expect.anything(),
    );
  });
});
