import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { takeSnapshots } from "./snapshots";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T10:00:00Z");

describe.runIf(url)("balance snapshots against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let checking: string;
  let noBalance: string;
  // Someone left out of the run (as another test file's person would be).
  let outsider: string;
  let outsiderAccount: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `snap-${crypto.randomUUID()}@example.com` } })
    ).id;
    checking = (
      await client.account.create({
        data: {
          userId,
          source: "csv",
          name: "Checking",
          type: "depository",
          currentBalanceCents: 250_000,
        },
      })
    ).id;
    noBalance = (
      await client.account.create({ data: { userId, source: "csv", name: "Card", type: "credit" } })
    ).id;
    outsider = (
      await client.user.create({ data: { email: `snap-out-${crypto.randomUUID()}@example.com` } })
    ).id;
    outsiderAccount = (
      await client.account.create({
        data: {
          userId: outsider,
          source: "csv",
          name: "Checking",
          type: "depository",
          currentBalanceCents: 90_000,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, outsider] } } });
    await client.$disconnect();
  });

  const rows = (accountId: string) =>
    client.balanceSnapshot.findMany({ where: { accountId }, orderBy: { date: "asc" } });

  it("keeps one snapshot per account per day, updated if run again", async () => {
    await takeSnapshots({ client, now: NOW, userIds: [userId] });
    await client.account.update({
      where: { id: checking },
      data: { currentBalanceCents: 260_000 },
    });
    await takeSnapshots({ client, now: new Date("2026-10-20T22:00:00Z"), userIds: [userId] });

    const saved = await rows(checking);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ userId, balanceCents: 260_000 });
    expect(saved[0].date.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(await rows(noBalance)).toEqual([]);
  });

  it("removes snapshots older than two years", async () => {
    await client.balanceSnapshot.create({
      data: { userId, accountId: checking, date: new Date("2024-01-01"), balanceCents: 1 },
    });
    const { removed } = await takeSnapshots({ client, now: NOW, userIds: [userId] });
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await rows(checking)).map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-10-20",
    ]);
  });

  it("keeps a run to the people it's given: nobody else's snapshot is taken or removed", async () => {
    await client.balanceSnapshot.create({
      data: {
        userId: outsider,
        accountId: outsiderAccount,
        date: new Date("2024-01-01"),
        balanceCents: 1,
      },
    });
    await takeSnapshots({ client, now: NOW, userIds: [userId] });
    expect((await rows(outsiderAccount)).map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2024-01-01",
    ]);
  });
});
