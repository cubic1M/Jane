import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/audit-records", () => ({ loadAuditRecords: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { loadAuditRecords } from "@/lib/audit-records";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { buildAuditPack } from "@/planning/audit-records";
import { GET } from "./route";

// Spec step 171: the audit pack as a CSV; the signed-in person's own records only.

const request = (query = "") =>
  new NextRequest(`http://localhost/taxes/audit-pack/download${query}`);
const pack = buildAuditPack(2025, [
  {
    key: "charity",
    label: "Donations",
    claimedCents: 30_000,
    evidence: [
      {
        kind: "transaction",
        id: "t1",
        date: "2025-05-01",
        payee: "Red Cross, Inc.",
        cents: 30_000,
        receipt: false,
      },
    ],
    needs: ["The charity's receipt for your gift to Red Cross, Inc."],
  },
  { key: "mileage", label: "Business miles", claimedCents: 7_250, evidence: [], needs: [] },
]);

describe("GET /taxes/audit-pack/download", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
    vi.mocked(loadAuditRecords)
      .mockReset()
      .mockResolvedValue({ ...pack, retention: [], due: [] });
    vi.mocked(logAudit).mockReset();
  });

  it("refuses visitors who aren't signed in, and honours the rate limit", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(request("?year=2025"))).status).toBe(401);
    expect(loadAuditRecords).not.toHaveBeenCalled();
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1" } as never);
    const limited = new Response("slow down", { status: 429 });
    vi.mocked(limitOrNull).mockResolvedValue(limited as never);
    expect((await GET(request("?year=2025"))).status).toBe(429);
  });

  it("downloads the pack with every source, and what's missing, and audit-logs it", async () => {
    const response = await GET(request("?year=2025"));
    expect(loadAuditRecords).toHaveBeenCalledWith("u1", 2025, expect.anything());
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audit-pack-2025.csv"',
    );
    expect(await response.text()).toBe(
      [
        "Item,Source,Date,Detail,Amount",
        "Donations,Claimed,,,300.00",
        'Donations,Transaction,2025-05-01,"Red Cross, Inc.",300.00',
        'Donations,Still needed,,"The charity\'s receipt for your gift to Red Cross, Inc.",',
        "Business miles,No source yet,,A document or receipt for it.,72.50",
        "",
      ].join("\r\n"),
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "u1" },
      "audit_pack_downloaded",
      { type: "user", id: "u1" },
      { year: 2025, items: 1, gaps: 1 },
    );
  });
});
