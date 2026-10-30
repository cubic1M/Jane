import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_INSTITUTION } from "@/data-sources/demo/demo-bank";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { forgetRemovedDemoBanks } from "./backfill";

// The one-off cleanup of demo banks disconnected before their derived rows went with them, against
// a real, migrated Postgres: from the audit log's link and removal of a demo bank, what was worked
// out since it was linked is forgotten, once; what came before stays.

const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.runIf(url)("demo banks removed before the cleanup existed", () => {
  let client: PrismaClient;
  let userId: string;
  const itemId = `item-${crypto.randomUUID()}`;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `backfill-${crypto.randomUUID()}@example.com` } })
    ).id;
    const linkedAt = new Date(Date.now() - 48 * HOUR);
    await client.auditLog.createMany({
      data: [
        {
          actorId: userId,
          actorType: "user",
          event: "item_linked",
          targetType: "plaid_item",
          targetId: itemId,
          metadata: { institution: DEMO_INSTITUTION, demo: true },
          createdAt: linkedAt,
        },
        {
          actorId: userId,
          actorType: "user",
          event: "item_removed",
          targetType: "plaid_item",
          targetId: itemId,
          metadata: { user_id: userId, institution: DEMO_INSTITUTION, reason: "user_disconnected" },
          createdAt: new Date(Date.now() - 24 * HOUR),
        },
      ],
    });
    await client.alert.createMany({
      data: [
        // From before the demo bank: the person's own.
        {
          userId,
          type: "low_balance",
          key: "own",
          title: "Own",
          body: ".",
          createdAt: new Date(linkedAt.getTime() - HOUR),
        },
        // While it was linked: the demo bank's.
        {
          userId,
          type: "low_balance",
          key: "demo",
          title: "Demo",
          body: ".",
          createdAt: new Date(linkedAt.getTime() + HOUR),
        },
      ],
    });
  });
  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { targetId: itemId } });
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("forgets what came after the demo bank was linked, once, and keeps what came before", async () => {
    const refresh = vi.fn(async () => {});
    expect(await forgetRemovedDemoBanks({ client, userIds: [userId], refresh })).toEqual({
      forgotten: 1,
      failed: 0,
    });
    expect(refresh).toHaveBeenCalledWith(userId);
    expect(
      (await client.alert.findMany({ where: { userId }, select: { key: true } })).map((a) => a.key),
    ).toEqual(["own"]);
    // Once: a second night does nothing.
    expect(await forgetRemovedDemoBanks({ client, userIds: [userId], refresh })).toEqual({
      forgotten: 0,
      failed: 0,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
