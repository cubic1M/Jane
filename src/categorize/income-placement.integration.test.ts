import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { correctCategory } from "@/lib/categories";
import { countCashIncome, declineCashIncome, markCashIncome } from "./cash-income";
import { markRegularPayers } from "./regular-payers";

// CodeRabbit sweep part 4 (P4-O10, P4-O20): transactions.income_placement says who put a deposit
// where it is, so one pass can tell its own placements from a rule's and from the person's word.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("who placed a deposit", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `income-placement-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    return { userId: user.id, accountId: account.id };
  }

  const credit = (
    who: { userId: string; accountId: string },
    i: number,
    over: { description: string; merchantName: string | null; cents: number; step?: number },
  ) =>
    client.transaction.create({
      data: {
        userId: who.userId,
        accountId: who.accountId,
        source: "csv",
        dedupeKey: `${over.description}-${i}`,
        date: new Date(Date.UTC(2026, 3, 3 + i * (over.step ?? 14))),
        amountCents: -over.cents,
        description: over.description,
        merchantName: over.merchantName,
      },
    });

  it("lifts the earlier steady credits to salary when the sixth one makes them paychecks", async () => {
    const who = await person();
    const name = { description: "NORTHWIND LABS", merchantName: "Northwind Labs", cents: 250_000 };
    for (let i = 0; i < 5; i += 1) await credit(who, i, name);
    const db = scopedFor(who.userId, client);
    await markRegularPayers(db);
    const first = await client.transaction.findMany({ where: { userId: who.userId } });
    expect(new Set(first.map((t) => t.pfcDetailed))).toEqual(new Set(["INCOME_OTHER"]));
    expect(new Set(first.map((t) => t.incomePlacement))).toEqual(new Set(["inferred"]));
    // Run again with nothing new: nothing changes, and nothing is counted as changed.
    expect(await markRegularPayers(db)).toBe(0);
    await credit(who, 5, name);
    await markRegularPayers(db);
    const rows = await client.transaction.findMany({ where: { userId: who.userId } });
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((t) => t.pfcDetailed))).toEqual(new Set(["INCOME_SALARY"]));
  });

  it("does not lift income a rule or the person placed", async () => {
    const who = await person();
    const name = { description: "NORTHWIND LABS", merchantName: "Northwind Labs", cents: 250_000 };
    for (let i = 0; i < 5; i += 1) {
      const row = await credit(who, i, name);
      await client.transaction.update({
        where: { id: row.id },
        data: { pfcPrimary: "INCOME", pfcDetailed: "INCOME_OTHER", categorySource: "user" },
      });
    }
    await credit(who, 5, name);
    await markRegularPayers(scopedFor(who.userId, client));
    const rows = await client.transaction.findMany({
      where: { userId: who.userId, categorySource: "user" },
    });
    expect(new Set(rows.map((t) => t.pfcDetailed))).toEqual(new Set(["INCOME_OTHER"]));
  });

  it("leaves a deposit the person gave the plain-deposit category by hand as they set it", async () => {
    const who = await person();
    const cash = { description: "MOBILE DEPOSIT", merchantName: null, cents: 8_000, step: 7 };
    for (let i = 0; i < 6; i += 1) {
      const row = await credit(who, i, cash);
      await client.transaction.update({
        where: { id: row.id },
        data: {
          pfcPrimary: "TRANSFER_IN",
          pfcDetailed: "TRANSFER_IN_DEPOSIT",
          categorySource: "rule",
        },
      });
    }
    const db = scopedFor(who.userId, client);
    const [one] = await client.transaction.findMany({ where: { userId: who.userId } });
    await correctCategory(who.userId, one!.id, "TRANSFER_IN_DEPOSIT", { client });
    await markCashIncome(db);
    const kept = await client.transaction.findUniqueOrThrow({ where: { id: one!.id } });
    expect([kept.categorySource, kept.pfcDetailed, kept.incomePlacement]).toEqual([
      "user",
      "TRANSFER_IN_DEPOSIT",
      "edited",
    ]);
  });

  it("marks a declined cash-income question, and a category set by hand is not that answer", async () => {
    const who = await person();
    const cash = { description: "MOBILE DEPOSIT", merchantName: null, cents: 8_000, step: 7 };
    for (let i = 0; i < 6; i += 1) {
      const row = await credit(who, i, cash);
      await client.transaction.update({
        where: { id: row.id },
        data: {
          pfcPrimary: "TRANSFER_IN",
          pfcDetailed: "TRANSFER_IN_DEPOSIT",
          categorySource: "rule",
        },
      });
    }
    const db = scopedFor(who.userId, client);
    await markCashIncome(db);
    expect(
      await client.transaction.count({
        where: { userId: who.userId, categorySource: "cash_income" },
      }),
    ).toBe(6);
    // The person's own category for one deposit while it counts: that is not a "no".
    const [one] = await client.transaction.findMany({ where: { userId: who.userId } });
    await correctCategory(who.userId, one!.id, "INCOME_OTHER", { client });
    await markCashIncome(db);
    expect(
      await client.transaction.count({
        where: { userId: who.userId, categorySource: "cash_income" },
      }),
    ).toBe(5);
    expect(
      (await client.transaction.findUniqueOrThrow({ where: { id: one!.id } })).incomePlacement,
    ).toBe("edited");
    // The "not income" answer is marked, and the way back clears it.
    expect(await declineCashIncome(db)).toBe(5);
    const declined = await client.transaction.findMany({
      where: { userId: who.userId, categorySource: "user", incomePlacement: "declined" },
    });
    expect(declined).toHaveLength(5);
    await markCashIncome(db);
    expect(
      await client.transaction.count({
        where: { userId: who.userId, categorySource: "cash_income" },
      }),
    ).toBe(0);
    await countCashIncome(db);
    expect(
      await client.transaction.count({
        where: { userId: who.userId, incomePlacement: "declined" },
      }),
    ).toBe(0);
  });
});
