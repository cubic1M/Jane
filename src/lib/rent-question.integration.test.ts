import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { answerRentInQuestion, loadRentInQuestion } from "./rent-question";

// Debugger 11-01: a nurse who rents out a condo got $1,950 by Zelle from her tenant each month,
// filed as a transfer in, so her income and taxes left the rent out. Jane asks; a yes files that
// payer's money as rental income, past and future, and a no keeps it a transfer. Either way the
// payer has the person's own rule, so Jane never asks again.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-01T16:00:00Z");

describe.runIf(url)("rent a person collects, asked once", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  const landlord = async () => {
    const user = await client.user.create({
      data: { email: `rent-in-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.createMany({
      data: ["2026-08-01", "2026-09-01", "2026-10-02"].map((day, i) => ({
        userId: user.id,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `rent-${i}`,
        date: new Date(`${day}T00:00:00Z`),
        amountCents: -195_000,
        description: "ZELLE PAYMENT FROM JORDAN TENANT RENT",
        pfcPrimary: "TRANSFER_IN",
        pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
        categorySource: "rule" as const,
      })),
    });
    return user.id;
  };

  it("asks, and a yes makes the payer's money rental income", async () => {
    const userId = await landlord();
    const asked = await loadRentInQuestion(userId, { client, now: NOW });
    expect(asked).toMatchObject({ name: "Jordan Tenant", amountCents: 195_000, months: 3 });

    expect(await answerRentInQuestion(userId, asked!.merchantKey, true, { client })).toEqual({
      updated: 3,
    });
    const rows = await client.transaction.findMany({ where: { userId } });
    expect(rows.map((r) => [r.pfcPrimary, r.pfcDetailed, r.categorySource])).toEqual(
      Array(3).fill(["INCOME", "INCOME_RENTAL", "user"]),
    );
    expect(await loadRentInQuestion(userId, { client, now: NOW })).toBeNull();
  });

  it("keeps it a transfer on a no, and never asks again", async () => {
    const userId = await landlord();
    const asked = await loadRentInQuestion(userId, { client, now: NOW });
    await answerRentInQuestion(userId, asked!.merchantKey, false, { client });
    const rows = await client.transaction.findMany({ where: { userId } });
    expect(new Set(rows.map((r) => r.pfcDetailed))).toEqual(
      new Set(["TRANSFER_IN_ACCOUNT_TRANSFER"]),
    );
    expect(await loadRentInQuestion(userId, { client, now: NOW })).toBeNull();
  });
});
