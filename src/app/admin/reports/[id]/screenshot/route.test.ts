import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, logAudit } = vi.hoisted(() => ({ findUnique: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/system-db", () => ({ systemDb: () => ({ problemReport: { findUnique } }) }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/crypto", () => ({ decryptBytes: (b: Uint8Array) => Buffer.from(b.subarray(1)) }));

import { requireAdmin } from "@/lib/session";
import { GET } from "./route";

// A feedback screenshot can show someone's money: founders only, never cached, every view audited
// and shown to the person.
const open = (id: string) =>
  GET(new Request(`http://localhost/admin/reports/${id}/screenshot`), {
    params: Promise.resolve({ id }),
  });

describe("GET /admin/reports/[id]/screenshot", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1" } as never);
    findUnique.mockReset();
    logAudit.mockReset();
  });

  it("is a 404 to anyone but an admin, before reading anything", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(open("rep1")).rejects.toThrow("404");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("shows the picture as it was sent, uncached, and audits the view", async () => {
    findUnique.mockResolvedValue({
      userId: "user_7",
      screenshotEncrypted: new Uint8Array([9, 1, 2, 3]),
      screenshotType: "image/png",
    });
    const response = await open("rep1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "admin_viewed_feedback_screenshot",
      { type: "user", id: "user_7" },
      { problem_report_id: "rep1" },
    );
  });

  it("is a 404 for a report without one, or a bad id", async () => {
    findUnique.mockResolvedValue({ screenshotEncrypted: null, screenshotType: null });
    expect((await open("rep1")).status).toBe(404);
    expect((await open("../x")).status).toBe(404);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
