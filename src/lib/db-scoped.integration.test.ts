import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "./db-scoped";

// Runs against a real, migrated Postgres: CI provides one; locally, point
// TEST_DATABASE_URL at a scratch database and run `npx prisma migrate deploy` on it.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("scopedFor against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let alice: { userId: string; findingId: string; itemId: string };
  let bob: { userId: string; findingId: string; itemId: string };

  async function seedUser(name: string) {
    const user = await client.user.create({ data: { email: `${name}-${suffix}@example.com` } });
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: "bank_fees",
        key: "account:checking",
        title: `${name}'s fees`,
        confidence: "high",
        annualSavingsCents: 3500,
      },
    });
    const item = await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `item-${name}-${suffix}`,
        accessTokenEncrypted: "v1.test.test.test",
      },
    });
    return { userId: user.id, findingId: finding.id, itemId: item.id };
  }

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    alice = await seedUser("alice");
    bob = await seedUser("bob");
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [alice.userId, bob.userId] } } });
    await client.$disconnect();
  });

  it("lists only the user's own rows", async () => {
    const findings = await scopedFor(alice.userId, client).findings.findMany();

    expect(findings.map((f) => f.id)).toEqual([alice.findingId]);
  });

  it("cannot read another user's row by id", async () => {
    const asAlice = scopedFor(alice.userId, client);

    expect(await asAlice.findings.findUnique({ where: { id: bob.findingId } })).toBeNull();
    expect(await asAlice.findings.findFirst({ where: { id: bob.findingId } })).toBeNull();
    expect(await asAlice.plaidItems.findUnique({ where: { id: bob.itemId } })).toBeNull();
  });

  it("cannot read another user's rows by filtering on their user id", async () => {
    const findings = await scopedFor(alice.userId, client).findings.findMany({
      where: { userId: bob.userId },
    });

    expect(findings).toEqual([]);
  });

  it("cannot count, update or delete another user's rows", async () => {
    const asAlice = scopedFor(alice.userId, client);

    expect(await asAlice.findings.count({ where: { id: bob.findingId } })).toBe(0);
    await expect(
      asAlice.findings.update({ where: { id: bob.findingId }, data: { title: "hacked" } }),
    ).rejects.toThrow();
    expect(
      (await asAlice.findings.updateMany({ where: { id: bob.findingId }, data: { title: "x" } }))
        .count,
    ).toBe(0);
    expect((await asAlice.findings.deleteMany({ where: { id: bob.findingId } })).count).toBe(0);

    const untouched = await client.finding.findUniqueOrThrow({ where: { id: bob.findingId } });
    expect(untouched.title).toBe("bob's fees");
  });

  it("creates rows for the scoped user even if another user id is passed", async () => {
    const created = await scopedFor(alice.userId, client).findings.create({
      data: {
        userId: bob.userId,
        type: "idle_cash",
        key: "depository",
        title: "idle",
        confidence: "low",
      },
    });

    expect(created.userId).toBe(alice.userId);
  });
});
