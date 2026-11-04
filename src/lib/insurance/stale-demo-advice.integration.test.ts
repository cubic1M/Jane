import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { listSavings } from "./savings";
import { openShops } from "./shop";

// Advice is worked out only in demo advice mode, but it's stored. Someone who tried the demo bank
// and then added a real account still had "Raise the deductible on your GEICO car policy" on Home
// and "Switch your GEICO policy to Lighthouse Insurance (demo)" on /jane.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("demo advice once a real account joins", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `stale-advice-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    const policy = await client.insurancePolicy.create({
      data: {
        userId,
        kind: "auto",
        carrier: "GEICO",
        source: "typed",
        status: "active",
        premiumCents: 14_200,
        premiumFrequency: "monthly",
        deductibleCents: 100_000,
      },
    });
    await client.insuranceSaving.create({
      data: {
        userId,
        policyId: policy.id,
        kind: "higher_deductible",
        status: "offered",
        yearlySavingCents: 18_900,
        currentYearlyCents: 170_400,
        newYearlyCents: 151_500,
        detail: {},
        createdAt: NOW,
      },
    });
    await client.insuranceShop.create({
      data: {
        userId,
        policyId: policy.id,
        key: `asked:${policy.id}:1`,
        reason: "asked",
        currentAnnualCents: 170_400,
        status: "open",
        savingCents: 40_000,
        quoteCount: 1,
        demo: true,
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("offers them on the demo bank, and not after a real account joins", async () => {
    const options = { client, now: NOW };
    expect(await listSavings(userId, options)).toHaveLength(1);
    expect(await openShops(userId, options)).toHaveLength(1);

    await client.account.create({
      data: { userId, source: "csv", name: "Real checking", type: "depository" },
    });

    expect(await listSavings(userId, options)).toEqual([]);
    expect(await listSavings(userId, { ...options, status: "offered" })).toEqual([]);
    expect(await openShops(userId, options)).toEqual([]);
  });
});
