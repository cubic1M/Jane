import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The news step has a time limit of its own: the daily reports and jobs behind it still run.

vi.mock("@/lib/digest/send", () => ({
  runDigests: vi.fn(async () => ({ sent: 1, previews: [] })),
}));
vi.mock("@/lib/daily-report/send", () => ({ runDailyReports: vi.fn(async () => ({ sent: 0 })) }));
vi.mock("@/lib/error-alerts", () => ({ sendErrorDigest: vi.fn(async () => {}) }));
vi.mock("@/lib/ops-alerts", () => ({ sendOpsDigest: vi.fn(async () => 0) }));
vi.mock("@/lib/invariants/accuracy-email", () => ({ sendAccuracyEmail: vi.fn(async () => false) }));
vi.mock("@/lib/health", () => ({
  reportMissedJobs: vi.fn(async () => []),
  recordRun: vi.fn(async (_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/jobs", () => ({ runDueJobs: vi.fn(async () => ({ done: 0 })) }));
vi.mock("@/lib/jane-agent/run", () => ({ runJaneAgentForAll: vi.fn(async () => ({ people: 0 })) }));
vi.mock("@/lib/monthly-report", () => ({ runMonthlyReports: vi.fn(async () => ({ sent: 0 })) }));
vi.mock("@/lib/news/store", () => ({ runNews: vi.fn(async () => ({ stored: 0 })) }));

import { runDailyReports } from "@/lib/daily-report/send";
import { runDueJobs } from "@/lib/jobs";
import { runNews } from "@/lib/news/store";
import { GET, maxDuration } from "./route";

const call = () =>
  GET(
    new Request("http://localhost/api/cron/digest", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );

describe("the news step's time limit", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("stops waiting for news that never answers, and runs what comes after", async () => {
    vi.useFakeTimers();
    vi.mocked(runNews).mockImplementationOnce(() => new Promise(() => {}));
    const ended = vi.fn<(body: Record<string, unknown>) => void>();
    void call().then(async (response) => ended(await response.json()));
    await vi.advanceTimersByTimeAsync((maxDuration * 1000) / 2);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended.mock.calls[0]![0]).toMatchObject({ news: null, jobs: { done: 0 } });
    expect(runDailyReports).toHaveBeenCalled();
    expect(runDueJobs).toHaveBeenCalled();
  });

  it("gives the news a budget, and doesn't start it with no time left", async () => {
    await call();
    const budget = vi.mocked(runNews).mock.calls[0]![0]!.budgetMs!;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan((maxDuration * 1000) / 2);
    vi.mocked(runNews).mockClear();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(maxDuration * 1000);
    await call();
    expect(runNews).not.toHaveBeenCalled();
  });
});
