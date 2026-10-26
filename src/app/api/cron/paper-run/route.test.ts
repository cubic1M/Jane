import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({
  recordRun: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/lib/paper/account", () => ({
  runPaperDayForAll: vi.fn(async () => ({ accounts: 2, ran: 2, failed: 0 })),
}));

import { recordRun } from "@/lib/health";
import { runPaperDayForAll } from "@/lib/paper/account";
import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/paper-run", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/paper-run", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    vi.mocked(runPaperDayForAll).mockClear();
  });

  it("refuses without the cron secret, or when none is configured", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(runPaperDayForAll).not.toHaveBeenCalled();
  });

  it("runs every paper account and records the run", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: 2, ran: 2, failed: 0 });
    expect(vi.mocked(recordRun).mock.calls.at(-1)?.[0]).toBe("paper-run");
  });
});
