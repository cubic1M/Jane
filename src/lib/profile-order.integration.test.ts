import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadProfileInput } from "./profile";

// What the profile is built from comes back in one order, whatever order the rows were written in:
// holdings largest first (src/lib/investments/holdings-order.ts), lines oldest first and a day's by
// what they say. In the table's order, two copies of the same person listed the fee card's funds
// and the bill card's payees differently (#2165's sweep, 11-20). Against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-12T20:00:00Z");

describe.runIf(url)("the profile's rows, in order", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("reads holdings largest first, though the smallest was written first", async () => {
    const user = await client.user.create({
      data: { email: `profile-order-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "401(k)", type: "investment", subtype: "401k" },
    });
    // Written smallest first: a table returns them in that order.
    for (const [ticker, valueCents] of [
      ["PDIFX", 309_113],
      ["SLGFX", 2_116_576],
      ["NSTDX", 3_826_807],
    ] as const) {
      const security = await client.security.create({
        data: {
          userId: user.id,
          plaidSecurityId: `csv:${ticker}-${user.id}`,
          name: ticker,
          ticker,
        },
      });
      await client.holding.create({
        data: {
          userId: user.id,
          accountId: account.id,
          securityId: security.id,
          quantity: 1,
          priceCents: valueCents,
          valueCents,
        },
      });
    }
    const input = await loadProfileInput(user.id, { client, now: NOW });
    expect((input.holdings ?? []).map((h) => h.ticker)).toEqual(["NSTDX", "SLGFX", "PDIFX"]);
  });

  it("reads lines oldest first and a day's by what they say, though written the other way", async () => {
    const user = await client.user.create({
      data: { email: `profile-order-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    for (const [date, description] of [
      ["2026-11-03", "XFINITY"],
      ["2026-11-03", "VERIZON WIRELESS"],
      ["2026-10-03", "XFINITY"],
    ] as const) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${date}T00:00:00Z`),
          description,
          amountCents: 8_999,
          pfcPrimary: "RENT_AND_UTILITIES",
          pfcDetailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        },
      });
    }
    const input = await loadProfileInput(user.id, { client, now: NOW });
    expect(input.transactions.map((t) => `${t.date} ${t.description}`)).toEqual([
      "2026-10-03 XFINITY",
      "2026-11-03 VERIZON WIRELESS",
      "2026-11-03 XFINITY",
    ]);
  });
});
