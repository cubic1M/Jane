import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_RETENTION_HOURS } from "@/config/rate-limits";
import type { PrismaClient } from "@/generated/prisma/client";
import { hit } from "./rate-limit";

describe("clearing out old rate limit windows", () => {
  afterEach(() => vi.restoreAllMocks());

  it("goes by the real clock, so a hit dated years ahead leaves today's windows alone", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const client = {
      $queryRaw: async () => [{ count: 1 }],
      rateLimit: { deleteMany },
    } as unknown as PrismaClient;

    const before = Date.now();
    await hit("decisions", "someone", { client, now: new Date("2040-01-01T00:00:00Z") });

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const [{ where }] = deleteMany.mock.calls[0] as unknown as [
      { where: { windowStart: { lt: Date } } },
    ];
    const retention = RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000;
    expect(where.windowStart.lt.getTime()).toBeGreaterThanOrEqual(before - retention);
    expect(where.windowStart.lt.getTime()).toBeLessThanOrEqual(Date.now() - retention);
  });
});
