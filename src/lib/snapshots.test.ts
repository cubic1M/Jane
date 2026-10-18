import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/db", () => ({ db: {} }));

import { takeSnapshots } from "./snapshots";

describe("takeSnapshots", () => {
  it("skips an account deleted mid-run instead of failing the whole job", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("foreign key", {
          code: "P2003",
          clientVersion: "x",
        }),
      )
      .mockResolvedValueOnce({});
    const client = {
      account: {
        findMany: vi.fn(async () =>
          ["a", "b", "c"].map((id) => ({ id, userId: "u", currentBalanceCents: 100 })),
        ),
      },
      balanceSnapshot: { upsert, deleteMany: vi.fn(async () => ({ count: 0 })) },
    } as unknown as PrismaClient;

    expect(await takeSnapshots({ client, now: new Date("2026-10-20T10:00:00Z") })).toEqual({
      saved: 2,
      skipped: 1,
      removed: 0,
    });
  });

  it("still fails on other errors", async () => {
    const client = {
      account: { findMany: vi.fn(async () => [{ id: "a", userId: "u", currentBalanceCents: 1 }]) },
      balanceSnapshot: { upsert: vi.fn().mockRejectedValue(new Error("database down")) },
    } as unknown as PrismaClient;
    await expect(takeSnapshots({ client })).rejects.toThrow("database down");
  });
});
