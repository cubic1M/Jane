import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { MarketData } from "@/lib/market";
import { loadPanicSells } from "./panic-sells";

// The cost of selling after a drop, from the person's own recorded sales, against a real,
// migrated Postgres and a recorded (fake) price history. Looking back only.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

const feed: MarketData = {
  name: "fake",
  simulated: false,
  async prices(ticker, from, to) {
    const all =
      ticker === "VTI"
        ? [
            { date: "2026-01-02", closeCents: 10_000 },
            { date: "2026-03-10", closeCents: 7_000 },
            { date: "2026-10-20", closeCents: 12_000 },
          ]
        : [];
    if (ticker === "NOPE") throw new Error("not a ticker");
    return all.filter((b) => b.date >= from && b.date <= to);
  },
  latest: async () => null,
  news: async () => [],
  filings: async () => [],
};

describe.runIf(url)("selling after a drop, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `panic-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Brokerage", type: "investment", subtype: "brokerage" },
    });
    const security = async (ticker: string) =>
      (
        await client.security.create({
          data: { userId, plaidSecurityId: `s-${ticker}`, name: ticker, ticker, type: "etf" },
        })
      ).id;
    const sell = async (
      ticker: string,
      date: string,
      quantity: number,
      priceCents: number,
      type = "sell",
    ) =>
      client.investmentTransaction.create({
        data: {
          userId,
          accountId: account.id,
          securityId: await security(ticker).catch(
            async () => (await client.security.findFirstOrThrow({ where: { userId, ticker } })).id,
          ),
          plaidInvestmentTransactionId: `tx-${crypto.randomUUID()}`,
          date: new Date(`${date}T00:00:00Z`),
          name: `${type} ${ticker}`,
          quantity,
          amountCents: Math.round(quantity * priceCents),
          priceCents,
          type,
          subtype: type,
        },
      });
    await sell("VTI", "2026-03-10", 40, 7_000);
    await sell("VTI", "2026-01-02", 5, 10_000, "buy");
    await sell("NOPE", "2026-03-10", 3, 5_000);
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("finds the sale after the drop and what holding would have added; skips buys and unknown tickers", async () => {
    const r = await loadPanicSells(userId, { client, now: NOW, feed });
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0]).toMatchObject({ ticker: "VTI", soldForCents: 280_000, costCents: 200_000 });
    expect(r.costCents).toBe(200_000);
  });

  it("is empty for someone with no sales", async () => {
    const other = (
      await client.user.create({ data: { email: `panic-o-${crypto.randomUUID()}@example.com` } })
    ).id;
    expect(await loadPanicSells(other, { client, now: NOW, feed })).toEqual({
      sales: [],
      costCents: 0,
      avoidedCents: 0,
    });
    await client.user.delete({ where: { id: other } });
  });
});
