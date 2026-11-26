import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { UNREADABLE, keyReport } from "./key-rotation";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the key report with a value whose key can't be told", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", `k2:${randomBytes(32).toString("base64")}`);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "k2");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `unread-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.plaidItem.create({
      data: { userId, plaidItemId: `item-${userId}`, accessTokenEncrypted: "k?:not-a-value" },
    });
  });
  afterAll(async () => {
    try {
      // With no id (the setup failed) the filter would be dropped, and every user would go.
      if (userId) await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await client.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  // It may be the old key's: removing that key could lose it for good.
  it("calls no old key safe to remove", async () => {
    const report = await keyReport({ client, userIds: [userId] });
    expect(report.missing).toContainEqual({ id: UNREADABLE, values: 1 });
    expect(report.keys.filter((k) => k.retirable)).toEqual([]);
  });
});
