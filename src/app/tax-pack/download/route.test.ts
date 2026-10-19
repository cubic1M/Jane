import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTaxPack } from "@/planning/tax-pack";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/tax-pack", () => ({ loadTaxPack: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { loadTaxPack } from "@/lib/tax-pack";
import { GET } from "./route";

const request = (query = "") => new NextRequest(`http://localhost/tax-pack/download${query}`);

const pack = buildTaxPack({
  year: 2025,
  today: "2026-10-18",
  loans: [],
  transactions: [
    {
      id: "t1",
      date: "2025-05-01",
      amountCents: 5_000,
      description: "RED CROSS",
      merchantName: "@Red Cross",
      pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    },
  ],
});

describe("GET /tax-pack/download", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(limitOrNull).mockReset().mockResolvedValue(null);
    vi.mocked(loadTaxPack).mockReset().mockResolvedValue(pack);
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(request("?year=2025"))).status).toBe(401);
    expect(loadTaxPack).not.toHaveBeenCalled();
  });

  it("downloads the signed-in person's own pack as an escaped CSV and audit-logs it", async () => {
    const response = await GET(request("?year=2025"));

    expect(loadTaxPack).toHaveBeenCalledWith("u1", 2025, expect.anything());
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="tax-time-pack-2025.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(
      [
        "Group,Date,Payee,Amount,Note",
        "Charity,2025-05-01,'@Red Cross,50.00,Tagged by Jane",
        "Summary,,Charity: total,50.00,",
        "Summary,,Medical: total,0.00,",
        "Summary,,Childcare: total,0.00,",
        "Summary,,Education: total,0.00,",
        "Summary,,Work expenses: total,0.00,",
        "Summary,,Business expenses: total,0.00,",
        "Summary,,Income from contracting or gig work: total,0.00,",
        "",
      ].join("\r\n"),
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "u1" },
      "tax_pack_downloaded",
      { type: "user", id: "u1" },
      { year: 2025, rows: 1 },
    );
  });

  it("falls back to the default year for a year it can't show", async () => {
    await GET(request("?year=1850"));
    const year = vi.mocked(loadTaxPack).mock.calls[0][1];
    expect(year).toBeGreaterThan(2000);
  });

  it("is rate limited", async () => {
    vi.mocked(limitOrNull).mockResolvedValue(new Response(null, { status: 429 }) as never);
    expect((await GET(request())).status).toBe(429);
    expect(limitOrNull).toHaveBeenCalledWith("taxPack", "u1");
  });
});
