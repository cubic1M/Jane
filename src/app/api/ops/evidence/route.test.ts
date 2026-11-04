import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops-invariants", () => ({
  jobStates: async () => [],
  recentErrors: async () => [
    { path: "/x", message: "m", count: 2, lastAt: "2026-11-03T00:00:00Z" },
  ],
}));
vi.mock("@/lib/ops-switches", () => ({ switchesOn: async () => [] }));

import { GET } from "./route";

const get = (secret?: string) =>
  GET(new Request("http://x", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

describe("/api/ops/evidence", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("refuses everyone until its own secret is set, and any other secret", async () => {
    expect((await get("x")).status).toBe(401);
    vi.stubEnv("OPS_READ_SECRET", "read");
    vi.stubEnv("OPS_FOUNDER_SECRET", "founder");
    expect((await get("founder")).status).toBe(401);
  });
  it("gives the reader grouped errors and job states", async () => {
    vi.stubEnv("OPS_READ_SECRET", "read");
    const body = await (await get("read")).json();
    expect(body.errors[0]).toEqual({
      path: "/x",
      message: "m",
      count: 2,
      lastAt: "2026-11-03T00:00:00Z",
    });
  });
});
