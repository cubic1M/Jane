import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn(), giveBack: vi.fn() }));

import { TRIAL_ID_PREFIX } from "@/config/trial";
import { hit } from "@/lib/rate-limit";
import { claudeLimit } from "./claude-limits";

// CodeRabbit part 2: a sample person's answer takes part of the day for everyone trying Jane
// (five cents) before their own count is checked. If that check fails with an error, the part of
// the day goes back, or the shared day fills with answers nobody was given.

describe("a sample person's Claude hold", () => {
  const NOW = new Date("2031-03-15T12:00:00Z");
  // The shared day counter, as the database would keep it.
  let day = 0;
  const client = {
    rateLimit: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      day += Number(values[3]);
      return [{ count: day }];
    }),
  } as unknown as PrismaClient;

  beforeEach(() => {
    day = 0;
  });

  it("goes back to the day when the person's own count fails", async () => {
    vi.mocked(hit).mockRejectedValue(new Error("rate limit store down"));
    await expect(claudeLimit(`${TRIAL_ID_PREFIX}abc`, { client, now: NOW })).rejects.toThrow(
      "rate limit store down",
    );
    expect(day).toBe(0);
  });
});
