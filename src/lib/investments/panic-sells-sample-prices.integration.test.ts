import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { MarketData } from "@/lib/market";
import { loadPanicSells } from "./panic-sells";

// An independent read of what Jane trusts from outside: with no market keys the feed is the
// sample market, and a real person who sold a ticker it knows read "those shares are worth $X".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

const sample: MarketData = {
  name: "sample",
  simulated: true,
  prices: async () => [
    { date: "2026-01-02", closeCents: 10_000 },
    { date: "2026-03-10", closeCents: 7_000 },
    { date: "2026-10-20", closeCents: 12_000 },
  ],
  latest: async () => null,
  news: async () => [],
  filings: async () => [],
};

describe.runIf(url)("the sample market's prices", () => {
  let client: PrismaClient;
  const people: string[] = [];

  const seller = async (demoBank: boolean) => {
    const { id: userId } = await client.user.create({
      data: { email: `panic-sample-${crypto.randomUUID()}@example.com` },
    });
    people.push(userId);
    if (demoBank) {
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
        },
      });
    }
    const account = await client.account.create({
      data: {
        userId,
        source: demoBank ? "plaid" : "csv",
        name: "Brokerage",
        type: "investment",
        subtype: "brokerage",
      },
    });
    const security = await client.security.create({
      data: { userId, plaidSecurityId: `s-${userId}`, name: "VTI", ticker: "VTI", type: "etf" },
    });
    await client.investmentTransaction.create({
      data: {
        userId,
        accountId: account.id,
        securityId: security.id,
        plaidInvestmentTransactionId: `t-${userId}`,
        date: new Date("2026-03-10T00:00:00Z"),
        name: "sell VTI",
        type: "sell",
        subtype: "sell",
        quantity: 40,
        priceCents: 7_000,
        amountCents: 280_000,
      },
    });
    return userId;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("say nothing about a real person's real sale", async () => {
    const r = await loadPanicSells(await seller(false), { client, now: NOW, feed: sample });
    expect(r.sales).toEqual([]);
  });

  it("still show the demo bank's sale", async () => {
    const r = await loadPanicSells(await seller(true), { client, now: NOW, feed: sample });
    expect(r.sales.length).toBe(1);
  });
});
