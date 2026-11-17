import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadReportFixes } from "./credit-report-fixes";

// Gate C: the Loans pages' "today" is the person's own (todayOf, src/lib/today.ts). On UTC's, at
// 7pm on Oct 31 in Los Angeles it was already November.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the Loans pages at 7pm", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `debt-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("read the 31st at 7pm on Oct 31, as at 3pm", async () => {
    const afternoon = await loadReportFixes(userId, {
      client,
      now: new Date("2026-10-31T22:00:00Z"),
    });
    const evening = await loadReportFixes(userId, {
      client,
      now: new Date("2026-11-01T02:00:00Z"),
    });
    expect(evening.asOf).toBe("2026-10-31");
    expect(evening).toEqual(afternoon);
  });
});
