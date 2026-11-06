import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { RuleError, saveRules } from "./standing-rules";

// An amount past what the column holds used to fail the save with a server error, against a real
// Postgres. It now says what's wrong.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a standing rule's amount", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `rule-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is refused in words when it's too large to keep", async () => {
    const huge = { key: "fight_price_increases", enabled: true, monthlyLimit: 3 };
    await expect(
      saveRules(userId, [{ ...huge, maxAnnualCents: 9_000_000_000 }], { client }),
    ).rejects.toBeInstanceOf(RuleError);
    await saveRules(userId, [{ ...huge, maxAnnualCents: 12_000 }], { client });
    expect(await client.standingRule.count({ where: { userId } })).toBe(1);
  });
});
