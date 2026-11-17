import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTaxPack } from "@/planning/tax-pack";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/tax-pack", () => ({ loadTaxPack: vi.fn() }));
// The person is in Los Angeles; their timezone comes from the database, not read here.
vi.mock("@/lib/today", async (original) => ({
  ...(await original<typeof import("@/lib/today")>()),
  todayOf: vi.fn(async (_userId: string, { now = new Date() }: { now?: Date } = {}) =>
    (await original<typeof import("@/lib/today")>()).localDate(now, "America/Los_Angeles"),
  ),
}));

import { getCurrentUser } from "@/lib/session";
import { loadTaxPack } from "@/lib/tax-pack";
import { GET } from "./route";

// Gate C: the pack's default year is the person's day's. Last year's pack is the default through
// Apr 30 (TAX_PACK_LAST_YEAR_UNTIL); on UTC's day it turned to this year's at 5pm that day in
// Los Angeles.

describe("the tax pack's default year at 7pm on Apr 30", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1" } as never);
    vi.mocked(loadTaxPack)
      .mockReset()
      .mockResolvedValue(
        buildTaxPack({ year: 2026, today: "2027-04-30", loans: [], transactions: [] }),
      );
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("is still last year's, as at 3pm", async () => {
    vi.setSystemTime(new Date("2027-04-30T22:00:00Z"));
    await GET(new NextRequest("http://localhost/tax-pack/download"));
    vi.setSystemTime(new Date("2027-05-01T02:00:00Z"));
    await GET(new NextRequest("http://localhost/tax-pack/download"));
    expect(vi.mocked(loadTaxPack).mock.calls.map((c) => c[1])).toEqual([2026, 2026]);
  });
});
