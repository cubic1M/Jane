import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { jobHealth, recordRun } from "./health";

// A nightly bank job that ends well with some syncs failed says how many on the health page.

const url = process.env.TEST_DATABASE_URL;
// Later than any other suite's runs, so these are the latest; removed afterwards.
const AT = new Date("2126-01-01T00:00:00Z");

describe.runIf(url)("the health report on a partly failed bank night", () => {
  let client: PrismaClient;
  const clear = () => client.cronRun.deleteMany({ where: { startedAt: { gte: AT } } });
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await clear();
  });
  afterAll(async () => {
    await clear();
    await client.$disconnect();
  });

  const nightly = async (minute: number, summary: Record<string, number>) => {
    const now = () => new Date(AT.getTime() + minute * 60_000);
    await recordRun("plaid-sync", async () => summary, { client, now });
    const jobs = await jobHealth({ client, now: now() });
    return jobs.find((j) => j.name === "plaid-sync");
  };

  it("says how many failed, and nothing when none did", async () => {
    expect(await nightly(1, { synced: 2, failed: 1, deferred: 0 })).toMatchObject({
      lastOk: true,
      note: "1 of 3 bank syncs failed",
    });
    expect(await nightly(2, { synced: 3, failed: 0, deferred: 0 })).toMatchObject({
      lastOk: true,
      note: null,
    });
  });
});
