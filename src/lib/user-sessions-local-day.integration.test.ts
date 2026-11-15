import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { listSessions } from "./user-sessions";

// Debugger 11-15: Settings → Where you're signed in read "Signed in 2026-11-15", UTC's day in ISO
// form, for a session started at 7pm on Nov 14 in Los Angeles. It's the person's own day, said as
// every other date in Settings is.

const url = process.env.TEST_DATABASE_URL;
// 7pm on Nov 14 in Los Angeles.
const SIGNED_IN = new Date("2026-11-15T03:00:00Z");
const NOW = new Date("2026-11-15T03:05:00Z");

describe.runIf(url)("where you're signed in, in the evening in Los Angeles", () => {
  let client: PrismaClient;
  let userId: string;
  const token = `local-day-${crypto.randomUUID()}`;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: {
          email: `sessions-day-${crypto.randomUUID()}@example.com`,
          timezone: "America/Los_Angeles",
        },
      })
    ).id;
    await client.session.create({
      data: {
        userId,
        sessionToken: token,
        expires: new Date(NOW.getTime() + 86_400_000),
        userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0",
        lastSeenAt: NOW,
        createdAt: SIGNED_IN,
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("says the day it was there", async () => {
    const [session] = await listSessions(userId, token, { client, now: NOW });
    expect(session.signedIn).toBe("Nov 14, 2026");
  });
});
