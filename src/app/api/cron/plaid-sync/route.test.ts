import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { plaidItem: { findMany } } }));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn(), ITEM_STATUS: { active: "active" } }));

import { syncItem } from "@/lib/plaid/sync";
import { GET } from "./route";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/plaid-sync", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("GET /api/cron/plaid-sync", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("PLAID_CLIENT_ID", "client");
    vi.stubEnv("PLAID_SECRET", "secret");
    findMany.mockReset().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    vi.mocked(syncItem).mockReset();
  });

  it("refuses calls without Vercel's cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("syncs active items not synced in the last day, and keeps going past failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(syncItem).mockRejectedValueOnce(new Error("bank down"));

    const response = await call("Bearer cron-secret");

    expect(await response.json()).toEqual({ synced: 1, failed: 1 });
    expect(syncItem).toHaveBeenCalledWith("a");
    expect(syncItem).toHaveBeenCalledWith("b");
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
    expect(where.OR[0]).toEqual({ lastSyncedAt: null });
  });
});
