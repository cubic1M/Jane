import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/data-export", () => ({
  exportUserData: vi.fn(async () => ({
    exportedAt: "2026-10-19T12:00:00.000Z",
    transactions: [{}, {}],
  })),
}));

import { logAudit } from "@/lib/audit";
import { exportUserData } from "@/lib/data-export";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

describe("GET /api/export", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(exportUserData).not.toHaveBeenCalled();
  });

  it("downloads the signed-in person's data as a dated JSON file and audit-logs it", async () => {
    const response = await GET();

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="jane-data-2026-10-19.json"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await response.text()).transactions).toHaveLength(2);
    expect(exportUserData).toHaveBeenCalledWith("u1");
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "u1" },
      "data_exported",
      { type: "user", id: "u1" },
      { transactions: 2 },
    );
  });

  it("is rate limited", async () => {
    vi.mocked(limitOrNull).mockResolvedValue(new Response(null, { status: 429 }) as never);
    expect((await GET()).status).toBe(429);
  });
});
