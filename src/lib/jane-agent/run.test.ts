import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runJaneAgentForAll, runJaneAgentSafely, type runJaneAgent } from "./run";

// Spec step 82: the daily run reaches the people Jane hasn't talked to longest first, at
// most a capped number a run, and one person's failure never stops the rest.

describe("runJaneAgentForAll", () => {
  const users = [
    { id: "recent", janeMessages: [{ createdAt: new Date("2026-10-18T10:00:00Z") }] },
    { id: "never", janeMessages: [] },
    { id: "older", janeMessages: [{ createdAt: new Date("2026-10-10T10:00:00Z") }] },
  ];
  const client = {
    user: { findMany: vi.fn(async () => users) },
  } as unknown as PrismaClient;

  it("runs for everyone with accounts, longest since Jane posted first, within the cap", async () => {
    const run = vi.fn<typeof runJaneAgent>(async () => ({ posted: 2 }));
    const now = new Date("2026-10-19T16:00:00Z");
    expect(await runJaneAgentForAll({ client, now, limit: 2, run })).toEqual({
      people: 2,
      posted: 4,
      failed: 0,
    });
    expect(run.mock.calls.map(([id]) => id)).toEqual(["never", "older"]);
    expect(run).toHaveBeenCalledWith("never", { client, now, trigger: "cron" });
    expect(client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          accounts: { some: {} },
          NOT: { id: { startsWith: "trial_" } },
        },
      }),
    );
  });

  // Debugger 10-31 (production): the digest cron hit its 300 s limit ("Task timed out after 300
  // seconds") running up to 200 people's daily chat one after another. With a budget it stops
  // when the time is up; the people it didn't reach are the stalest tomorrow, so they go first.
  it("stops when its time is up", async () => {
    let clock = 0;
    const run = vi.fn<typeof runJaneAgent>(async () => {
      clock += 1_000;
      return { posted: 1 };
    });
    expect(await runJaneAgentForAll({ client, run, budgetMs: 1_500, clock: () => clock })).toEqual({
      people: 2,
      posted: 2,
      failed: 0,
    });
    expect(run.mock.calls.map(([id]) => id)).toEqual(["never", "older"]);
  });

  it("carries on past one person's failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ posted: 1 });
    expect(await runJaneAgentForAll({ client, run })).toEqual({ people: 3, posted: 2, failed: 1 });
  });
});

describe("runJaneAgentSafely", () => {
  it("never throws, so a sync or import can't fail because of the chat", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      user: { findUnique: vi.fn().mockRejectedValue(new Error("database down")) },
    } as unknown as PrismaClient;
    await expect(runJaneAgentSafely("u1", { client })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Jane's chat run failed", {
      userId: "u1",
      error: "Error: database down",
    });
  });
});
