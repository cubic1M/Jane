import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { runRetention } from "@/lib/retention";
import { addSpend, overMonthlyPersonCap } from "./spend";

// Debugger 11-14, while tracing a flaky cap test: a person's month of chat spend is a rate_limits row
// whose window starts on the 1st ("chatspendmonth:<id>"). It wasn't among the counters the cleanups
// keep, so from the 2nd of the month either cleanup (retention's, or rate-limit.ts's now and then)
// deleted it, and the person's month cap counted again from nothing. Dated in 1990 like the retention
// test, so its cleanup only reaches rows that old.

const url = process.env.TEST_DATABASE_URL;
const FIRST = new Date("1990-06-01T12:00:00Z");
const TENTH = new Date("1990-06-10T12:00:00Z");

describe.runIf(url)("a person's month of chat spend", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `month-cap-kept-${crypto.randomUUID()}@example.com` },
      })
    ).id;
  });
  afterAll(async () => {
    await client.rateLimit.deleteMany({ where: { key: { endsWith: userId } } });
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("outlives the day's cleanup, so the month cap still holds on the 10th", async () => {
    // More than the month's allowance, on the 1st.
    await addSpend(
      userId,
      { model: "claude-sonnet-5-5", inputTokens: 0, outputTokens: 200_000 },
      { client, now: FIRST },
    );
    expect(await overMonthlyPersonCap(userId, { client, now: TENTH })).toBe(true);
    await runRetention({ client, now: TENTH });
    expect(await overMonthlyPersonCap(userId, { client, now: TENTH })).toBe(true);
  });
});
