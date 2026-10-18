import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
import { demoBankEnabled, demoPlaidApi, isDemoItemId, isDemoToken } from "./demo";

describe("demo bank switches", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is offered only without Plaid and outside production, unless turned on", () => {
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(demoBankEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(demoBankEnabled()).toBe(false);
    vi.stubEnv("DEMO_BANK", "1");
    expect(demoBankEnabled()).toBe(true);
    vi.stubEnv("DEMO_BANK", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PLAID_CLIENT_ID", "id");
    vi.stubEnv("PLAID_SECRET", "secret");
    expect(demoBankEnabled()).toBe(false);
  });

  it("tells demo items and tokens from real Plaid ones", () => {
    expect(isDemoItemId("demo-abc")).toBe(true);
    expect(isDemoItemId("eVBnVMp7zdTJLkRNr33Rs6zr7KNJqBFL9DrE6")).toBe(false);
    expect(isDemoToken("demo:abc:2026-10-18")).toBe(true);
    expect(isDemoToken("access-sandbox-de3ce8ef")).toBe(false);
  });

  it("answers syncs through yesterday, then nothing until the next day", async () => {
    const api = demoPlaidApi("demo:abc123:2026-10-18", new Date("2026-10-18T12:00:00Z"));
    const first = (await api.transactionsSync({ access_token: "x" })).data;
    expect(first.next_cursor).toBe("2026-10-17");
    expect(first.added.length).toBeGreaterThan(400);
    const again = (await api.transactionsSync({ access_token: "x", cursor: "2026-10-17" })).data;
    expect(again.added).toEqual([]);
    expect(again.next_cursor).toBe("2026-10-17");
    expect(() => demoPlaidApi("access-sandbox-1")).toThrow();
  });
});
