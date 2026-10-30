import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import {
  cashIncomeStatus,
  countCashIncome,
  declineCashIncome,
  markCashIncome,
} from "./cash-income";

// A server's tips, deposited in cash, are sorted as income where they're stored; a one-off isn't;
// the person's "not income" sticks through the next sync, and can be undone.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("cash deposits counted as income", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("counts regular deposits, leaves a one-off, and listens to 'not income'", async () => {
    const user = await client.user.create({
      data: { email: `cash-income-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    let n = 0;
    const tx = (day: number, amountCents: number, description: string, pfcDetailed: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: String(n++),
          date: new Date(Date.UTC(2026, 7, 1 + day)),
          amountCents,
          description,
          pfcPrimary: pfcDetailed.startsWith("TRANSFER_IN") ? "TRANSFER_IN" : "FOOD_AND_DRINK",
          pfcDetailed,
          categorySource: "rule",
        },
      });
    const days = [0, 4, 7, 11, 14, 18, 21, 25, 28, 32, 35, 39, 42, 46, 49, 53, 56, 60, 63, 67];
    for (const [i, d] of days.entries()) {
      await tx(d, -(15_000 + (i % 5) * 4_000), "ATM CASH DEPOSIT", "TRANSFER_IN_DEPOSIT");
    }
    const car = await tx(40, -650_000, "BRANCH DEPOSIT", "TRANSFER_IN_DEPOSIT");
    await tx(3, 4_500, "SAFEWAY", "FOOD_AND_DRINK_GROCERIES");
    const db = scopedFor(user.id, client);
    const sorted = () =>
      client.transaction.groupBy({
        by: ["pfcPrimary", "categorySource"],
        where: { userId: user.id, amountCents: { lt: 0 } },
        _count: true,
        orderBy: { pfcPrimary: "asc" },
      });

    expect(await markCashIncome(db)).toBe(days.length);
    expect(await sorted()).toEqual([
      { pfcPrimary: "INCOME", categorySource: "cash_income", _count: days.length },
      { pfcPrimary: "TRANSFER_IN", categorySource: "rule", _count: 1 },
    ]);
    expect(
      await client.transaction.findUniqueOrThrow({
        where: { id: car.id },
        select: { pfcPrimary: true },
      }),
    ).toEqual({ pfcPrimary: "TRANSFER_IN" });
    // Again: nothing changes.
    expect(await markCashIncome(db)).toBe(0);
    const status = await cashIncomeStatus(db);
    expect(status).toMatchObject({ counted: true, count: days.length });
    expect(status?.counted && status.percent).toBeGreaterThan(0);

    // "Not income": back to deposits, the person's, and the next sync leaves them.
    expect(await declineCashIncome(db)).toBe(days.length);
    expect(await markCashIncome(db)).toBe(0);
    expect(await cashIncomeStatus(db)).toEqual({ counted: false, count: days.length });
    expect((await sorted()).map((r) => r.pfcPrimary)).toEqual(["TRANSFER_IN", "TRANSFER_IN"]);

    // And undone.
    expect(await countCashIncome(db)).toBe(days.length);
    expect(await cashIncomeStatus(db)).toMatchObject({ counted: true, count: days.length });
  });
});
