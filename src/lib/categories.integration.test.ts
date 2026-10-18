import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { categorizeTransactions } from "@/categorize/categorize";
import { scopedFor } from "./db-scoped";
import { CategoryError, correctCategory, removeMerchantRule } from "./categories";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("category corrections against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `cat-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Card", type: "credit" },
    });
    const tx = (key: string, description: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: key,
          date: new Date("2026-10-01"),
          amountCents: 4_500,
          description,
          pfcPrimary: "GENERAL_MERCHANDISE",
          pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
          categorySource: "llm",
        },
      });
    const a = await tx("1", "CORNER MARKET 0042");
    const b = await tx("2", "CORNER MARKET 0042 #2");
    const other = await tx("3", "HARDWARE PLUS");
    return { id: user.id, a, b, other };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  const categoryOf = async (id: string) =>
    client.transaction.findUniqueOrThrow({
      where: { id },
      select: { pfcDetailed: true, categorySource: true },
    });

  it("fixes one transaction", async () => {
    const me = await person();
    await correctCategory(me.id, me.a.id, "FOOD_AND_DRINK_GROCERIES", { client });
    expect(await categoryOf(me.a.id)).toEqual({
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      categorySource: "user",
    });
    expect((await categoryOf(me.b.id)).categorySource).toBe("llm");
  });

  it("applies a merchant rule to past transactions and to new ones, only for this person", async () => {
    const me = await person();
    const someoneElse = await person();

    const { updated } = await correctCategory(me.id, me.a.id, "FOOD_AND_DRINK_GROCERIES", {
      client,
      forMerchant: true,
    });

    expect(updated).toBe(2);
    expect((await categoryOf(me.b.id)).pfcDetailed).toBe("FOOD_AND_DRINK_GROCERIES");
    expect((await categoryOf(me.other.id)).categorySource).toBe("llm");
    // The same merchant on someone else's card is untouched.
    expect(await categoryOf(someoneElse.a.id)).toEqual({
      pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      categorySource: "llm",
    });

    // A later import categorizes new rows with the rule, for this person only.
    const fresh = {
      accountRef: "x",
      date: "2026-10-09",
      amountCents: 1_000,
      description: "CORNER MARKET 0042 #3",
      merchantName: null,
      categoryPrimary: "GENERAL_MERCHANDISE",
      categoryDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      pending: false,
      externalId: "new",
      hints: {},
    };
    const [mine] = await categorizeTransactions([fresh], scopedFor(me.id, client));
    const [theirs] = await categorizeTransactions([fresh], scopedFor(someoneElse.id, client));
    expect(mine).toMatchObject({
      categorySource: "user",
      category: { detailed: "FOOD_AND_DRINK_GROCERIES" },
    });
    expect(theirs.categorySource).toBe("plaid");

    await removeMerchantRule(me.id, "corner market", { client });
    const [after] = await categorizeTransactions([fresh], scopedFor(me.id, client));
    expect(after.categorySource).toBe("plaid");
  });

  it("refuses another person's transaction and unknown categories", async () => {
    const me = await person();
    const someoneElse = await person();
    await expect(
      correctCategory(me.id, someoneElse.a.id, "FOOD_AND_DRINK_GROCERIES", { client }),
    ).rejects.toBeInstanceOf(CategoryError);
    await expect(correctCategory(me.id, me.a.id, "MADE_UP", { client })).rejects.toBeInstanceOf(
      CategoryError,
    );
  });
});
