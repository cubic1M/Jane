import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops-invariants", () => ({
  jobStates: async () => [
    { name: "digest", lastOk: true, lastFinishedAt: "2026-11-03T00:00:00.000Z", previousOk: true },
  ],
}));
vi.mock("@/lib/ops-switches", () => ({ switchesOn: async () => [] }));

import { GET } from "./route";

const get = (secret?: string) =>
  GET(new Request("http://x", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

describe("/api/ops/invariants", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses everyone until its own secret is set", async () => {
    expect((await get("anything")).status).toBe(401);
    vi.stubEnv("OPS_READ_SECRET", "read");
    vi.stubEnv("CRON_SECRET", "cron");
    expect((await get("cron")).status).toBe(401);
  });
  it("gives names, times and the commit, and nothing else", async () => {
    vi.stubEnv("OPS_READ_SECRET", "read");
    const body = await (await get("read")).json();
    expect(Object.keys(body).toSorted()).toEqual(["commit", "jobs", "switches"]);
    expect(Object.keys(body.jobs[0]).toSorted()).toEqual([
      "lastFinishedAt",
      "lastOk",
      "name",
      "previousOk",
    ]);
  });
});
