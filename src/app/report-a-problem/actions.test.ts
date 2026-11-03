import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, logAudit, track } = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "rep_1" })),
  logAudit: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user_1" })) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedDb: vi.fn(async () => ({ userId: "user_1", problemReports: { create } })),
}));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/analytics", () => ({ track }));
vi.mock("@/lib/rate-limit", () => ({
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
}));

import { hit } from "@/lib/rate-limit";
import { sendProblemReport } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("sendProblemReport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the words and the page, audits it by id, and tells analytics nothing", async () => {
    const result = await sendProblemReport(
      form({ from: "/transactions?q=rent", message: "A row is missing." }),
    );
    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      data: { userId: "user_1", path: "/transactions", message: "A row is missing." },
      select: { id: true },
    });
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: "user_1" }, "problem_reported", {
      type: "problem_report",
      id: "rep_1",
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("asks for words instead of saving nothing", async () => {
    expect(await sendProblemReport(form({ from: "/home", message: " " }))).toEqual({
      ok: false,
      error: "Say what went wrong, in a few words.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  // /admin/reports shows the newest 200, and a sample person needs no account.
  it("stops at a few reports an hour, so nobody can push real ones off the page", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    const result = await sendProblemReport(form({ from: "/home", message: "It broke." }));
    expect(result).toMatchObject({ ok: false });
    expect(hit).toHaveBeenCalledWith("problemReports", "user_1");
    expect(create).not.toHaveBeenCalled();
  });
});
