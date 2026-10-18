import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MERCHANT_SEED } from "@/config/merchant-seed";
import { PrismaClient } from "@/generated/prisma/client";
import { merchantFor } from "./merchants";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the merchant directory in the database", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => client.$disconnect());

  it("is seeded with every merchant in the seed list", async () => {
    const keys = (await client.merchant.findMany({ select: { key: true } })).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(MERCHANT_SEED.map((m) => m.key)));
  });

  it("finds a merchant by key or alias", async () => {
    expect((await merchantFor("netflix", { client }))?.cancelUrl).toBe(
      "https://www.netflix.com/cancelplan",
    );
    expect((await merchantFor("hbo max", { client }))?.name).toBe("Max");
    expect(await merchantFor("corner shop", { client })).toBeNull();
  });
});
