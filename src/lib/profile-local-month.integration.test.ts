import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadProfileInput } from "./profile";

// Gate C's calendar sweep (src/sweep/), 11-15: the profile's "this month", "last month" and "this
// year" were UTC's. At 7pm on Oct 31 in Los Angeles it was already November in UTC: the goals'
// room this month and last month's close were read for the wrong month (the preretire sample
// person's goals were $42,350 a year short at 3pm and $44,054 at 7pm). They're the person's.

const url = process.env.TEST_DATABASE_URL;
// 3pm and 7pm on Oct 31 in Los Angeles; 7pm is already Nov 1 in UTC.
const AFTERNOON = new Date("2026-10-31T22:00:00Z");
const EVENING = new Date("2026-11-01T02:00:00Z");

describe.runIf(url)("the profile's month on the person's own calendar", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `profile-month-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    // September's books are closed; October's aren't yet.
    await client.monthClose.create({
      data: { userId, month: "2026-09", status: "closed", uncertain: [], figures: {} },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("reads last month as September at 7pm on Oct 31, as at 3pm", async () => {
    const lastClose = async (now: Date) =>
      (await loadProfileInput(userId, { client, now })).extras?.lastCloseStatus;
    expect(await lastClose(AFTERNOON)).toBe("closed");
    expect(await lastClose(EVENING)).toBe("closed");
  });
});
