import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { netWorthHistory } from "./net-worth-history";

// Gate C's calendar sweep (src/sweep/), 11-15: Home's net worth chart ended on UTC's day, so at 7pm
// in Los Angeles it had a point for tomorrow. It ends on the person's own today, the same at 7pm
// as at 3pm.

const url = process.env.TEST_DATABASE_URL;
// 3pm and 7pm on Nov 15 in Los Angeles; 7pm is already Nov 16 in UTC.
const AFTERNOON = new Date("2026-11-15T23:00:00Z");
const EVENING = new Date("2026-11-16T03:00:00Z");

describe.runIf(url)("Home's net worth chart on the person's own day", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `net-worth-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        currentBalanceCents: 250_000,
        createdAt: new Date("2026-11-10T18:00:00Z"),
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("ends on their today at 7pm as at 3pm", async () => {
    const afternoon = await netWorthHistory(userId, 250_000, { client, now: AFTERNOON });
    expect(afternoon.at(-1)).toEqual({ date: "2026-11-15", cents: 250_000 });
    expect(await netWorthHistory(userId, 250_000, { client, now: EVENING })).toEqual(afternoon);
  });
});
