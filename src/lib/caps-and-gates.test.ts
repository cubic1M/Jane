import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { KEEP_RATE_LIMIT_PREFIXES } from "@/config/rate-limits";
import { SHARE_INVITES_TOTAL } from "@/config/share";
import type { PrismaClient } from "@/generated/prisma/client";
import { stillAnAdmin } from "./admin-emails";
import { checkCode } from "./invites";

describe("what a read of the promises and the people-to-people paths found", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Retention deletes counters older than a couple of days, so a monthly one has to be kept, or a
  // person's monthly cap on Claude's background work starts over every night.
  it("keeps the monthly background Claude counter", () => {
    expect(KEEP_RATE_LIMIT_PREFIXES).toContain("claudebgmonth:");
  });

  it("gives nobody admin in production when the list has gone missing", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(stillAnAdmin("former@example.com")).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(stillAnAdmin("former@example.com")).toBe(true);
  });

  // Each person who joins gets a share link of 10, so 1 becomes 10, then 100, in a beta of a few
  // dozen, each with a Claude allowance out of one month's total.
  it("holds everyone's share links together to the beta's size, not the team's codes", async () => {
    const client = (shared: boolean, usedByAll: number) =>
      ({
        inviteCode: {
          findUnique: async () => ({
            maxUses: 10,
            uses: 1,
            expiresAt: null,
            revokedAt: null,
            email: null,
            sharedById: shared ? "someone" : null,
          }),
          aggregate: async () => ({ _sum: { uses: usedByAll } }),
        },
      }) as unknown as PrismaClient;
    const code = "ABCD-EFGH-JKMN";
    expect(await checkCode(code, { client: client(true, SHARE_INVITES_TOTAL) })).toBe("used_up");
    expect(await checkCode(code, { client: client(true, SHARE_INVITES_TOTAL - 1) })).toBe("ok");
    expect(await checkCode(code, { client: client(false, SHARE_INVITES_TOTAL) })).toBe("ok");
    expect(SHARE_INVITES_TOTAL).toBeLessThanOrEqual(50);
  });

  it("still goes by the list when there is one", () => {
    vi.stubEnv("ADMIN_EMAILS", "team@example.com");
    vi.stubEnv("NODE_ENV", "production");
    expect(stillAnAdmin("TEAM@example.com")).toBe(true);
    expect(stillAnAdmin("former@example.com")).toBe(false);
  });
});
