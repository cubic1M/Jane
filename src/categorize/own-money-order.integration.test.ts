import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { reapplyRules } from "./reapply";
import { markRegularPayers } from "./regular-payers";

// Pre-deploy walk of 11-27 (a figure): when the checking statement was uploaded before the savings
// statement, a regular move between the person's own two accounts was income (In $250 too high),
// and the nightly re-sort kept it once the other side of the move was there. Upload order must not
// change the income figure.
const url = process.env.TEST_DATABASE_URL;

const DAYS = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];

describe.runIf(url)("a move between the person's own accounts, in either upload order", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `own-money-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = (name: string) =>
      client.account.create({
        data: { userId: user.id, source: "csv", name, type: "depository" },
      });
    const [checking, savings] = [await account("Checking"), await account("Savings")];
    let n = 0;
    // The checking side: money in, as an import places it (the rules call it a transfer).
    const checkingRows = () =>
      Promise.all(
        DAYS.map((day) =>
          client.transaction.create({
            data: {
              userId: user.id,
              accountId: checking.id,
              source: "csv",
              dedupeKey: `in-${n++}`,
              date: new Date(day),
              amountCents: -25_000,
              description: "ZELLE FROM DANA LEE",
              merchantName: "Dana Lee",
              pfcPrimary: "TRANSFER_IN",
              pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
              categorySource: "rule",
            },
          }),
        ),
      );
    // The savings side: the same money leaving, a day apart.
    const savingsRows = () =>
      Promise.all(
        DAYS.map((day) =>
          client.transaction.create({
            data: {
              userId: user.id,
              accountId: savings.id,
              source: "csv",
              dedupeKey: `out-${n++}`,
              date: new Date(new Date(day).getTime() - 86_400_000),
              amountCents: 25_000,
              description: "ZELLE TO DANA LEE",
              merchantName: "Dana Lee",
              pfcPrimary: "TRANSFER_OUT",
              pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
              categorySource: "rule",
            },
          }),
        ),
      );
    // What the nightly work does, then the money in.
    const night = async () => {
      await markRegularPayers(scopedFor(user.id, client));
      await reapplyRules(user.id, { client });
    };
    const incomeCents = async () =>
      (
        await client.transaction.aggregate({
          where: { userId: user.id, pfcPrimary: "INCOME" },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0;
    return { user, checkingRows, savingsRows, night, incomeCents };
  }

  it("counts no income whichever statement came first", async () => {
    const checkingFirst = await person();
    await checkingFirst.checkingRows();
    await checkingFirst.night();
    // Alone, the regular money in reads as income.
    expect(await checkingFirst.incomeCents()).toBe(-100_000);
    await checkingFirst.savingsRows();
    await checkingFirst.night();

    const savingsFirst = await person();
    await savingsFirst.savingsRows();
    await savingsFirst.night();
    await savingsFirst.checkingRows();
    await savingsFirst.night();

    expect(await savingsFirst.incomeCents()).toBe(0);
    expect(await checkingFirst.incomeCents()).toBe(0);
  });

  it("leaves a category the person set themselves", async () => {
    const me = await person();
    const rows = await me.checkingRows();
    await me.night();
    await client.transaction.update({
      where: { id: rows[0].id },
      data: { pfcPrimary: "INCOME", pfcDetailed: "INCOME_OTHER", categorySource: "user" },
    });
    await me.savingsRows();
    await me.night();
    expect(await me.incomeCents()).toBe(-25_000);
  });
});
