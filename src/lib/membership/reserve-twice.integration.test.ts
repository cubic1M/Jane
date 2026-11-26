import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { reserveMembership } from "./service";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("two reservations at once", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `reserve-${crypto.randomUUID()}@example.com` } })
    ).id;
  });

  afterAll(async () => {
    try {
      // With no id (the setup failed) the filter would be dropped, and every user would go.
      if (userId) await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await client.$disconnect();
    }
  });

  it("make one", async () => {
    await Promise.all(Array.from({ length: 5 }, () => reserveMembership(userId, { client })));
    expect(await client.membershipIntent.count({ where: { userId } })).toBe(1);
    expect(track).toHaveBeenCalledTimes(1);
  });
});
