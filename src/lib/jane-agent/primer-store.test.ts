import { describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn(async () => {}) }));
vi.mock("./snapshot-store", () => ({ staleAndRefreshSnapshot: refresh }));

import { markPrimerStale } from "./primer-store";

// A tap rebuilds the snapshot behind the next question. It is rebuilt as of the tap's time, not
// the real clock: on the real clock it settled a test's rollover (step 211) before the test did.
describe("markPrimerStale", () => {
  const client = {
    janePreference: { findUnique: vi.fn(async () => null), update: vi.fn() },
  } as never;

  it("rebuilds the snapshot as of the time it is given", async () => {
    const now = new Date("2026-10-18T15:00:00Z");
    await markPrimerStale("u1", { client, now });
    expect(refresh).toHaveBeenLastCalledWith("u1", { client, now });
  });

  it("uses the clock when no time is given", async () => {
    const before = Date.now();
    await markPrimerStale("u1", { client });
    const used = (refresh.mock.lastCall as unknown as [string, { now: Date }])[1].now;
    expect(used.getTime()).toBeGreaterThanOrEqual(before);
  });
});
