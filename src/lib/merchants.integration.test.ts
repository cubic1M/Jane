import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MERCHANT_SEED } from "@/config/merchant-seed";
import { PrismaClient } from "@/generated/prisma/client";
import { companyFacts } from "./merchants";

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

  it("finds a company by name or alias, the way the bank writes it", async () => {
    const merchant = async (name: string | null) => (await companyFacts(name, { client })).merchant;
    expect((await merchant("netflix"))?.cancelUrl).toBe("https://www.netflix.com/cancelplan");
    expect((await merchant("NETFLIX.COM"))?.key).toBe("netflix");
    expect((await merchant("hbo max"))?.name).toBe("Max");
    expect(await merchant("corner shop")).toBeNull();
    expect(await companyFacts(null, { client })).toEqual({ merchant: null, outcome: null });
    // No kind of action asked about: no outcome lookup.
    expect((await companyFacts("netflix", { client })).outcome).toBeNull();
  });
});
