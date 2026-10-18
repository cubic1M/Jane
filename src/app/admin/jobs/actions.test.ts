import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ retryJob: vi.fn(async () => true) }));

import { logAudit } from "@/lib/audit";
import { retryJob } from "@/lib/jobs";
import { requireAdmin } from "@/lib/session";
import { retry } from "./actions";

const form = (jobId: string) => {
  const data = new FormData();
  data.set("jobId", jobId);
  return data;
};

describe("retry", () => {
  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("notFound"));
    await expect(retry(form("j1"))).rejects.toThrow("notFound");
    expect(retryJob).not.toHaveBeenCalled();
  });

  it("retries a failed job and logs it", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ id: "admin_1", role: "admin" } as never);
    await retry(form("j1"));
    expect(retryJob).toHaveBeenCalledWith("j1");
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "job_retried",
      { type: "job", id: "j1" },
      {},
    );
  });
});
