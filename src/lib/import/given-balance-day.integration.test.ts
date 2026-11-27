import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { keepFileBalances, keepGivenBalance } from "./balances";

// Gate C: a balance the person types is as of their own day (todayFor, src/lib/today.ts). On
// UTC's, one typed at 7pm in Los Angeles was dated tomorrow.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a balance typed at 7pm", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `given-balance-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is kept as that day's, not tomorrow's", async () => {
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    // 7pm on Nov 16 in Los Angeles.
    await keepGivenBalance(
      scopedFor(userId, client),
      account.id,
      123_400,
      new Date("2026-11-17T03:00:00Z"),
    );
    const kept = await client.balanceSnapshot.findMany({
      where: { accountId: account.id },
      select: { date: true },
    });
    expect(kept.map((k) => k.date.toISOString().slice(0, 10))).toEqual(["2026-11-16"]);
  });

  it("keeps a typed balance in the history when a statement has one for the same day", async () => {
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Savings",
        type: "depository",
        subtype: "savings",
        currentBalanceCents: 500_000,
      },
    });
    const db = scopedFor(userId, client);
    await keepGivenBalance(db, account.id, 500_000, new Date("2026-11-16T20:00:00Z"));
    await keepFileBalances(db, account.id, [
      { date: "2026-11-16", balanceCents: 123_000 },
      { date: "2026-11-10", balanceCents: 100_000 },
    ]);
    const kept = await client.balanceSnapshot.findMany({
      where: { accountId: account.id },
      orderBy: { date: "asc" },
      select: { date: true, balanceCents: true, source: true },
    });
    expect(kept.map((k) => [k.date.toISOString().slice(0, 10), k.balanceCents])).toEqual([
      ["2026-11-10", 100_000],
      ["2026-11-16", 500_000],
    ]);
    const now = await client.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(now.currentBalanceCents).toBe(500_000);
  });
});
