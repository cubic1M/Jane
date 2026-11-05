import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_INSTITUTION } from "@/data-sources/demo/demo-bank";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { forgetRemovedDemoBanks } from "./backfill";

// Anyone can link and remove the demo bank all day. Each removal cleans up after itself now, so
// those rows must cost the nightly job nothing: it had no clock, and ran before the night's rest.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("demo banks removed since each removal cleans up after itself", () => {
  let client: PrismaClient;
  let userId: string;
  const itemId = `item-${crypto.randomUUID()}`;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `backfill-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.auditLog.createMany({
      data: (["item_linked", "item_removed"] as const).map((event) => ({
        actorId: userId,
        actorType: "user",
        event,
        targetType: "plaid_item",
        targetId: itemId,
        metadata: { user_id: userId, institution: DEMO_INSTITUTION },
      })),
    });
  });

  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { targetId: itemId } });
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("aren't the nightly job's to do: no refresh and no marker", async () => {
    const refresh = vi.fn(async () => {});
    expect(await forgetRemovedDemoBanks({ client, userIds: [userId], refresh })).toEqual({
      forgotten: 0,
      failed: 0,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(await client.janePreference.count({ where: { userId, kind: "system" } })).toBe(0);
  });
});
