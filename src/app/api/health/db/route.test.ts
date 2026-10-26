import { describe, expect, it, vi } from "vitest";

// What the database does next (a plain function, not a mock that records its results).
const database = vi.hoisted(() => ({ answer: async (): Promise<unknown> => [1] }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: () => database.answer() } }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));

import { GET } from "./route";

// The uptime check's database probe: ok or not, and nothing else, never cached.
describe("GET /api/health/db", () => {
  it("is ok when the database answers", async () => {
    database.answer = async () => [{ "?column?": 1 }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is 503 when it doesn't, without saying why", async () => {
    database.answer = async () => {
      throw new Error("could not reach db-host:5432 as user secretname");
    };
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: false });
    expect(body).not.toMatch(/db-host|5432|secretname/);
  });
});
