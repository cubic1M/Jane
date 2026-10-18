import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadTaxPack } from "./tax-pack";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");

describe.runIf(url)("loading the tax-time pack from a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];

  async function person(name: string) {
    const user = await client.user.create({
      data: { email: `taxpack-${name}-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: `${name} card`, type: "credit" },
    });
    const row = (date: string, amountCents: number, pfcDetailed: string, pending = false) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description: `${name} ${pfcDetailed}`,
      pfcDetailed,
      pending,
    });
    await client.transaction.createMany({
      data: [
        row("2026-03-01", 5_000, "GOVERNMENT_AND_NON_PROFIT_DONATIONS"),
        row("2026-12-31", 2_500, "GOVERNMENT_AND_NON_PROFIT_DONATIONS"),
        row("2025-12-31", 9_900, "GOVERNMENT_AND_NON_PROFIT_DONATIONS"),
        row("2026-04-01", 7_700, "GOVERNMENT_AND_NON_PROFIT_DONATIONS", true),
        row("2026-06-01", 18_000, "MEDICAL_DENTAL_CARE"),
        row("2026-07-01", -50_000, "INCOME_GIG_ECONOMY"),
        row("2026-07-02", 4_000, "FOOD_AND_DRINK_GROCERIES"),
      ],
    });
    const mortgage = await client.account.create({
      data: { userId: user.id, source: "csv", name: `${name} home loan`, type: "loan" },
    });
    await client.liability.create({
      data: {
        userId: user.id,
        accountId: mortgage.id,
        kind: "mortgage",
        ytdInterestPaidCents: 400_000,
      },
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("gathers only the person's own posted transactions in the year", async () => {
    const me = await person("me");
    await person("other");

    const pack = await loadTaxPack(me, 2026, { client, now: NOW });

    expect(pack.charity.rows.map((r) => r.date)).toEqual(["2026-03-01", "2026-12-31"]);
    expect(pack.charity.totalCents).toBe(7_500);
    expect(pack.preparer.medical.totalCents).toBe(18_000);
    expect(pack.income.quarterCents).toEqual([0, 0, 50_000, 0]);
    expect(pack.interest).toEqual([{ name: "me home loan", kind: "mortgage", cents: 400_000 }]);
    expect(JSON.stringify(pack)).not.toContain("other");
  });
});
