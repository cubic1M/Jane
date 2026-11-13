import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { monthlyCapCents } from "@/lib/jane-agent/claude-limits";
import { monthStartUtc } from "@/lib/dates";
import { betaCosts, type BetaCosts } from "./beta-costs";

// /admin/costs against a real database. Other tests share it, so this counts its own people only:
// a real bank counts (and one removed this month), the demo bank and a try never do.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the beta's costs this month", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let before: BetaCosts;
  let after: BetaCosts;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const person = async (name: string, id?: string) => {
      const user = await client.user.create({
        data: { ...(id ? { id } : {}), email: `costs-${name}-${suffix}@example.com` },
      });
      ids.push(user.id);
      return user.id;
    };
    const student = await person("student");
    const looker = await person("looker");
    const trial = await person("trial", `trial_costs${suffix}`);

    await client.plaidItem.create({
      data: {
        userId: student,
        plaidItemId: `item-${suffix}`,
        accessTokenEncrypted: "x",
        status: "login_required",
        liabilities: true,
      },
    });
    const demo = await client.plaidItem.create({
      data: { userId: looker, plaidItemId: `demo-${suffix}`, accessTokenEncrypted: "demo:x" },
    });
    await client.account.create({
      data: { userId: looker, source: "plaid", itemId: demo.id, name: "Demo", type: "depository" },
    });
    await client.plaidItem.create({
      data: { userId: trial, plaidItemId: `item-t-${suffix}`, accessTokenEncrypted: "x" },
    });
    // Removed this month: a real bank is billed for the month, a demo or a try's isn't.
    await client.auditLog.createMany({
      data: [
        { actorType: "user", event: "item_removed", metadata: { user_id: student, demo: false } },
        { actorType: "user", event: "item_removed", metadata: { user_id: looker, demo: true } },
        { actorType: "user", event: "item_removed", metadata: { user_id: trial, demo: false } },
      ],
    });
    await client.activityEvent.create({
      data: { userId: student, visitId: `v-${suffix}`, kind: "page_view", path: "/home" },
    });
    await client.activityEvent.create({
      data: { userId: trial, visitId: `t-${suffix}`, kind: "page_view", path: "/home" },
    });
    before = await betaCosts({ client, userIds: [] });
    after = await betaCosts({ client, userIds: ids });
  });

  afterAll(async () => {
    await client.auditLog.deleteMany({
      where: { event: "item_removed", metadata: { path: ["user_id"], string_contains: suffix } },
    });
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("counts real banks, connected and removed, and never the demo bank or a try", () => {
    expect(after.plaid.connected - before.plaid.connected).toBe(1);
    expect(after.plaid.needSignIn - before.plaid.needSignIn).toBe(1);
    expect(after.plaid.withLiabilities - before.plaid.withLiabilities).toBe(1);
    expect(after.plaid.linkedThisMonth - before.plaid.linkedThisMonth).toBe(1);
    expect(after.plaid.removedThisMonth - before.plaid.removedThisMonth).toBe(1);
    expect(after.plaid.billedThisMonth - before.plaid.billedThisMonth).toBe(2);
  });

  it("counts real people who came this month, not tries or the demo bank alone", () => {
    expect(after.people.signedUp - before.people.signedUp).toBe(1);
    expect(after.people.activeThisMonth - before.people.activeThisMonth).toBe(1);
    expect(after.people.activeThisWeek - before.people.activeThisWeek).toBe(1);
  });

  it("shows Claude's month against its cap", () => {
    expect(after.claude.capCents).toBe(monthlyCapCents());
    expect(after.month).toBe(monthStartUtc(new Date()).toISOString().slice(0, 7));
  });
});
