import { MONTHLY_REPORTS_CRON_BUDGET_MS } from "@/config/monthly-report";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/digest/send", () => ({
  runDigests: vi.fn(async () => ({ sent: 1, previews: [] })),
}));
vi.mock("@/lib/error-alerts", () => ({ sendErrorDigest: vi.fn(async () => {}) }));
vi.mock("@/lib/health", () => ({
  reportMissedJobs: vi.fn(async () => []),
  recordRun: vi.fn(async (_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/jobs", () => ({
  runDueJobs: vi.fn(async () => ({ done: 0, retried: 0, failed: 0 })),
}));
vi.mock("@/lib/jane-agent/run", () => ({ runJaneAgentForAll: vi.fn(async () => ({ people: 0 })) }));
vi.mock("@/lib/monthly-report", () => ({ runMonthlyReports: vi.fn(async () => ({ sent: 0 })) }));
vi.mock("@/lib/news/store", () => ({ runNews: vi.fn(async () => ({ batches: 0 })) }));

import { CONTROLLER_RUN_RESERVE_MS } from "@/config/controller";
import { runDigests } from "@/lib/digest/send";
import { runMonthlyReports } from "@/lib/monthly-report";
import { runDueJobs } from "@/lib/jobs";
import { runJaneAgentForAll } from "@/lib/jane-agent/run";
import { CHAT_CRON_BUDGET_MS } from "@/config/agent-chat";
import { GET, maxDuration } from "./route";

const call = (authorization?: string, query = "") =>
  GET(
    new Request(`http://localhost/api/cron/digest${query}`, {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/digest", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.mocked(runDueJobs).mockClear();
  });

  it("refuses calls without Vercel's cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runDigests).not.toHaveBeenCalled();
  });

  // Debugger 10-31 (production): the health check called this job stale for over a day. Its
  // limit is declared and its due jobs get only what's left of it, less one run's worth.
  it("runs the digests and gives its due jobs only the time left", async () => {
    expect(maxDuration).toBeGreaterThanOrEqual(300);
    const body = await (await call("Bearer cron-secret")).json();
    expect(body).toMatchObject({ sent: 1, jobs: { done: 0 } });
    const budget = vi.mocked(runDueJobs).mock.calls[0][0]!.budgetMs!;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS);
    // The daily chat for everyone has its own budget, well inside the limit (it timed out at
    // 300 s in production on 10-31).
    // Review 10-31: never more than the time left (the digests and monthly reports run first).
    const chat = vi.mocked(runJaneAgentForAll).mock.calls[0][0]!.budgetMs!;
    expect(chat).toBeGreaterThan(0);
    expect(chat).toBeLessThanOrEqual(CHAT_CRON_BUDGET_MS);
    vi.mocked(runJaneAgentForAll).mockClear();
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(250_000);
    await call("Bearer cron-secret");
    vi.restoreAllMocks();
    expect(vi.mocked(runJaneAgentForAll).mock.calls[0][0]!.budgetMs).toBe(0);
    expect(CHAT_CRON_BUDGET_MS).toBeLessThan(maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS);
  });

  // Debugger 11-01 (production): a 504 at 300 s on the 1st, the monthly reports first and with
  // no clock. They get their own budget, never more than the time left.
  it("gives the monthly reports a budget inside the time left", async () => {
    vi.mocked(runMonthlyReports).mockClear();
    await call("Bearer cron-secret");
    const budget = vi.mocked(runMonthlyReports).mock.calls[0][0]!.budgetMs!;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(MONTHLY_REPORTS_CRON_BUDGET_MS);
    expect(MONTHLY_REPORTS_CRON_BUDGET_MS + CHAT_CRON_BUDGET_MS).toBeLessThan(
      maxDuration * 1000 - CONTROLLER_RUN_RESERVE_MS,
    );
  });
});
