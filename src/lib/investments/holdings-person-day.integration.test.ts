import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadInvestments } from "./holdings";

// Gate C: Investing reads the person's own day (todayOf, src/lib/today.ts). On UTC's, at 7pm on
// Oct 31 in Los Angeles its months already ran to November.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("Investing at 7pm", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `holdings-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is as of the 31st at 7pm on Oct 31, its months as at 3pm", async () => {
    const afternoon = await loadInvestments(userId, {
      client,
      now: new Date("2026-10-31T22:00:00Z"),
    });
    const evening = await loadInvestments(userId, {
      client,
      now: new Date("2026-11-01T02:00:00Z"),
    });
    expect(evening.asOf).toBe("2026-10-31");
    expect(evening.months.map((m) => m.month)).toEqual(afternoon.months.map((m) => m.month));
  });
});
