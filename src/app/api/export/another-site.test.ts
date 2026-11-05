import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/rate-limit", () => ({ limitOrNull: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/data-export", () => ({ exportUserData: vi.fn() }));
vi.mock("@/lib/tax-pack", () => ({ loadTaxPack: vi.fn() }));
vi.mock("@/lib/audit-records", () => ({ loadAuditRecords: vi.fn() }));

import { GET as exportAll } from "./route";
import { GET as taxPack } from "@/app/tax-pack/download/route";
import { GET as auditPack } from "@/app/taxes/audit-pack/download/route";
import { exportUserData } from "@/lib/data-export";
import { logAudit } from "@/lib/audit";

// A link on another site carries the session cookie: it mustn't drop someone's money data in the
// downloads folder of whatever computer they're at, or write that they asked for it.
describe("a download started from another site's link", () => {
  beforeEach(() => vi.clearAllMocks());

  const from = (site: string, path: string) =>
    new NextRequest(`http://localhost${path}`, { headers: { "sec-fetch-site": site } });

  it.each(["cross-site", "same-site"])("%s: nothing is read or recorded", async (site) => {
    for (const [route, path, back] of [
      [exportAll, "/api/export", "/settings"],
      [taxPack, "/tax-pack/download?year=2026", "/tax-pack"],
      [auditPack, "/taxes/audit-pack/download?year=2026", "/taxes"],
    ] as const) {
      const answer = await route(from(site, path));
      expect(answer.status).toBe(303);
      expect(new URL(answer.headers.get("location") ?? "").pathname).toBe(back);
      expect(answer.headers.get("content-disposition")).toBeNull();
    }
    expect(exportUserData).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
