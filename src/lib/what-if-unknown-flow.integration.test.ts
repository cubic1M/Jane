import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadBaseline } from "./what-if";

// CodeRabbit sweep 1b: a person with a known cash balance and no income or spending on file got
// a what-if baseline of $0 income and $0 spending.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("what-if baseline with the monthly flow unknown", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `whatif-flow-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Savings",
        type: "depository",
        subtype: "savings",
        currentBalanceCents: 500_000,
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is no baseline, not a $0-income one", async () => {
    expect(await loadBaseline(userId, { client, now: NOW })).toBeNull();
  });
});
