import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterJobs } = vi.hoisted(() => ({ afterJobs: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (job: () => Promise<unknown>) => afterJobs.push(job),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/import/background", () => ({ currentImportRun: vi.fn() }));
vi.mock("@/lib/statement-trial-rescue", () => ({ rescueStuckTry: vi.fn(async () => "none") }));

import { currentImportRun } from "@/lib/import/background";
import { getCurrentUser } from "@/lib/session";
import { rescueStuckTry } from "@/lib/statement-trial-rescue";
import { GET } from "./route";

describe("GET /api/import/status", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(currentImportRun).mockReset();
    vi.mocked(rescueStuckTry).mockClear();
    afterJobs.length = 0;
  });

  const run = {
    id: "r1",
    kind: "upload",
    rows: 172,
    stage: "looking",
    percent: 40,
    foundCents: null,
  } as const;

  it("says how the person's own latest upload is getting on, never cached", async () => {
    vi.mocked(currentImportRun).mockResolvedValue(run);
    const response = await GET();
    expect(await response.json()).toEqual({ run });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(currentImportRun).toHaveBeenCalledWith("u1");
  });

  it("is null when there's nothing to show", async () => {
    vi.mocked(currentImportRun).mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ run: null });
  });

  // The chip asks on signed-out pages too (/, /login, /goodbye): no error, nothing looked up.
  it("is null, not a 401, for someone who isn't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ run: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(currentImportRun).not.toHaveBeenCalled();
  });

  it("looks after a temporary try's unfinished upload, after the response", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "trial_own_abc" } as never);
    vi.mocked(currentImportRun).mockResolvedValue(run);
    const response = await GET();
    expect(await response.json()).toEqual({ run: { ...run, temporary: true } });
    expect(rescueStuckTry).not.toHaveBeenCalled();
    await Promise.all(afterJobs.map((job) => job()));
    expect(rescueStuckTry).toHaveBeenCalledWith("trial_own_abc");
  });

  it("leaves a finished upload, and anyone else's, alone", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "trial_own_abc" } as never);
    vi.mocked(currentImportRun).mockResolvedValue({ ...run, stage: "done" });
    await GET();
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "cm1real" } as never);
    vi.mocked(currentImportRun).mockResolvedValue(run);
    await GET();
    expect(afterJobs).toHaveLength(0);
  });
});
