import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { takeSnapshots } from "./snapshots";

// Gate C: a balance snapshot is the owner's day's. An upload's background refresh takes one right
// after the balance is saved, and on UTC's day a student in Los Angeles saving at 9pm got a
// snapshot dated tomorrow beside the typed balance's (debug 3, 11-17: Nia's Citi card had
// "2026-11-16 given" and "2026-11-17" two seconds apart).

const url = process.env.TEST_DATABASE_URL;
// 7pm on Nov 16 in Los Angeles; noon on Nov 17 in Tokyo.
const NOW = new Date("2026-11-17T03:00:00Z");

describe.runIf(url)("a balance snapshot taken in the evening", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  const personWithBalance = async (timezone: string) => {
    const user = await client.user.create({
      data: { email: `snap-day-${crypto.randomUUID()}@example.com`, timezone },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 61_240,
      },
    });
    return { userId: user.id, accountId: account.id };
  };

  const datesOf = async (accountId: string) =>
    (await client.balanceSnapshot.findMany({ where: { accountId }, select: { date: true } })).map(
      (s) => s.date.toISOString().slice(0, 10),
    );

  it("is dated the owner's own day, not UTC's", async () => {
    const la = await personWithBalance("America/Los_Angeles");
    const tokyo = await personWithBalance("Asia/Tokyo");
    await takeSnapshots({ client, now: NOW, userIds: [la.userId, tokyo.userId] });
    expect(await datesOf(la.accountId)).toEqual(["2026-11-16"]);
    expect(await datesOf(tokyo.accountId)).toEqual(["2026-11-17"]);
  });
});
