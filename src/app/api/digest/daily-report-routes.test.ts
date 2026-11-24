import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userUpdateMany, userFindUnique, userUpdate } = vi.hoisted(() => ({
  userUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { updateMany: userUpdateMany, findUnique: userFindUnique, update: userUpdate } },
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/digest/send", () => ({ runDigests: vi.fn() }));
vi.mock("@/lib/daily-report/send", () => ({ runDailyReports: vi.fn() }));
vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
  reportMissedJobs: vi.fn(async () => []),
}));
vi.mock("@/lib/jobs", () => ({
  runDueJobs: vi.fn(async () => ({ done: 0, retried: 0, failed: 0 })),
}));
// The cron's other steps never run here for real: the news summaries could call a market-data or
// model provider when their keys are set, and the chat and monthly runs read every person.
vi.mock("@/lib/news/store", () => ({ runNews: vi.fn(async () => ({})) }));
vi.mock("@/lib/jane-agent/run", () => ({ runJaneAgentForAll: vi.fn(async () => ({})) }));
vi.mock("@/lib/monthly-report", () => ({ runMonthlyReports: vi.fn(async () => ({})) }));
vi.mock("@/lib/error-alerts", () => ({ sendErrorDigest: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops-alerts", () => ({ sendOpsDigest: vi.fn(async () => undefined) }));
vi.mock("@/lib/invariants/accuracy-email", () => ({
  sendAccuracyEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { runDailyReports } from "@/lib/daily-report/send";
import { runDigests } from "@/lib/digest/send";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { runJaneAgentForAll } from "@/lib/jane-agent/run";
import { runDueJobs } from "@/lib/jobs";
import { runMonthlyReports } from "@/lib/monthly-report";
import { runNews } from "@/lib/news/store";
import { GET as cron } from "../cron/digest/route";
import { POST as unsubscribe } from "../unsubscribe/route";

// The daily report's two routes: the cron that sends it (with the weekly email, once a day) and the
// one-click unsubscribe in every report.

const dailyRun = {
  users: 2,
  sent: 1,
  outsideWindow: 1,
  alreadySent: 0,
  failed: 0,
  deferred: 0,
  excluded: {},
  previews: [{ userId: "u1", subject: "s", text: "t" }],
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  userUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  vi.mocked(track).mockReset();
  vi.mocked(logAudit).mockReset();
  vi.mocked(runDigests).mockReset().mockResolvedValue({
    users: 1,
    sent: 0,
    skipped: 0,
    alreadySent: 0,
    failed: 0,
    excluded: {},
    previews: [],
  });
  vi.mocked(runDailyReports).mockReset().mockResolvedValue(dailyRun);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/digest and the daily report", () => {
  const call = (query = "", auth = "Bearer cron-secret") =>
    cron(
      new Request(`https://app.example.com/api/cron/digest${query}`, {
        headers: { authorization: auth },
      }),
    );

  it("refuses a call without the cron secret before any report is built or sent", async () => {
    for (const auth of ["Bearer nope", "", "cron-secret", "Bearer "]) {
      expect((await call("", auth)).status).toBe(401);
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("", "Bearer undefined")).status).toBe(401);
    expect(runDailyReports).not.toHaveBeenCalled();
    expect(runDigests).not.toHaveBeenCalled();
  });

  it("sends the daily report with the right secret, and says how many went", async () => {
    const body = await (await call()).json();
    expect(runDailyReports).toHaveBeenCalledTimes(1);
    expect(body.dailyReports).toMatchObject({ users: 2, sent: 1, outsideWindow: 1 });
  });

  // Enough people at a couple of seconds each would use up the function's 300 seconds: the report
  // gets a share of the time that is left, and runs after what was there before it, so it can't
  // starve the chat, the monthly reports or the news.
  it("runs after the chat, the monthly reports and the news, with a time budget of its own", async () => {
    await call();

    const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0];
    expect(order(runDailyReports)).toBeGreaterThan(order(runJaneAgentForAll));
    expect(order(runDailyReports)).toBeGreaterThan(order(runMonthlyReports));
    expect(order(runDailyReports)).toBeGreaterThan(order(runNews));
    expect(order(runDailyReports)).toBeLessThan(order(runDueJobs));

    const { budgetMs } = vi.mocked(runDailyReports).mock.calls[0][0] ?? {};
    // At most its own cap (and never more than half of what is left above the jobs' reserve).
    expect(budgetMs).toBeGreaterThan(0);
    expect(budgetMs).toBeLessThanOrEqual(90_000);
  });

  it("renders the daily reports in a dry run without sending them", async () => {
    const body = await (await call("?dry_run=1")).json();
    expect(runDailyReports).toHaveBeenCalledWith({ dryRun: true });
    expect(body.dailyReports.previews).toEqual(dailyRun.previews);
  });

  it("goes on with the rest of the run when the daily report fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runDailyReports).mockRejectedValue(new Error("boom"));
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).dailyReports).toBeNull();
    expect(runDigests).toHaveBeenCalled();
  });
});

describe("POST /api/unsubscribe?what=daily", () => {
  const post = (query: string) =>
    unsubscribe(
      new Request(`https://app.example.com/api/unsubscribe?${query}`, { method: "POST" }),
    );

  it("turns off only the daily report, in one click, without signing in", async () => {
    const response = await post(`token=${unsubscribeToken("u1")}&what=daily`);

    expect(response.status).toBe(200);
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { dailyReportEnabled: false },
    });
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: "u1" }, "daily_report_unsubscribed", {
      type: "user",
      id: "u1",
    });
    expect(track).toHaveBeenCalledWith("u1", "daily_report_unsubscribed", {});
  });

  it("sends the page's button back to a confirmation about the daily report", async () => {
    const response = await post(`token=${unsubscribeToken("u1")}&what=daily&from=page`);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/unsubscribe?done=1&what=daily",
    );
  });

  it("changes nothing for a forged token", async () => {
    expect((await post("token=abc.def&what=daily")).status).toBe(400);
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
