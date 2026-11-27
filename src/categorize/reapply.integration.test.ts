import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { reapplyRules } from "./reapply";

// Rows saved before a rule got better are brought up to date; nobody's own choice is touched.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("re-applying the keyword rules to saved rows", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("moves rent paid by Zelle to rent, and leaves other sources alone", async () => {
    const user = await client.user.create({
      data: { email: `reapply-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    let n = 0;
    const tx = (
      description: string,
      pfcDetailed: string | null,
      categorySource: "rule" | "user" | "llm" | null,
    ) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: String(n++),
          date: new Date("2026-10-01"),
          amountCents: 185_000,
          description,
          pfcPrimary: pfcDetailed?.split("_").slice(0, 2).join("_") ?? null,
          pfcDetailed,
          categorySource,
        },
      });
    const rent = await tx("ZELLE TO OAK RIDGE APTS RENT", "TRANSFER_OUT_ACCOUNT_TRANSFER", "rule");
    const savings = await tx("TRANSFER TO SAV XXXXX4410", null, null);
    const mine = await tx(
      "ZELLE TO MAPLE APTS RENT",
      "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      "user",
    );
    const claude = await tx("ZELLE TO PINE APTS RENT", "TRANSFER_OUT_ACCOUNT_TRANSFER", "llm");
    const card = await tx("ONLINE PAYMENT RENT", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "rule");
    const friend = await tx("ZELLE TO JOHN SMITH", "TRANSFER_OUT_ACCOUNT_TRANSFER", "rule");

    expect(await reapplyRules(user.id, { client })).toBe(2);
    const of = async (id: string) =>
      client.transaction.findUniqueOrThrow({
        where: { id },
        select: { pfcPrimary: true, pfcDetailed: true, categorySource: true },
      });
    expect(await of(rent.id)).toEqual({
      pfcPrimary: "RENT_AND_UTILITIES",
      pfcDetailed: "RENT_AND_UTILITIES_RENT",
      categorySource: "rule",
    });
    expect((await of(savings.id)).pfcDetailed).toBe("TRANSFER_OUT_SAVINGS");
    expect((await of(mine.id)).pfcDetailed).toBe("GENERAL_SERVICES_OTHER_GENERAL_SERVICES");
    expect((await of(claude.id)).pfcDetailed).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
    expect((await of(card.id)).pfcDetailed).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    expect((await of(friend.id)).pfcDetailed).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");

    // Nothing left to move the second time.
    expect(await reapplyRules(user.id, { client })).toBe(0);
  });

  // CodeRabbit sweep: the pass reads its rows, then writes them in a later statement. A person's
  // edit that lands in between must keep their category.
  it("keeps a category the person sets between the read and the write", async () => {
    const user = await client.user.create({
      data: { email: `reapply-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const row = await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        dedupeKey: "race",
        date: new Date("2026-10-01"),
        amountCents: 185_000,
        description: "ZELLE TO OAK RIDGE APTS RENT",
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        categorySource: "rule",
      },
    });
    let edited = false;
    // The person's edit commits right after the pass's read.
    const racing = new Proxy(client, {
      get(target, prop) {
        if (prop === "$extends") return target.$extends.bind(target);
        if (prop === "$transaction") {
          return async (...args: unknown[]) => {
            const result = await (target.$transaction as (...a: unknown[]) => Promise<unknown>)(
              ...args,
            );
            if (!edited && JSON.stringify(result).includes("OAK RIDGE")) {
              edited = true;
              await client.transaction.update({
                where: { id: row.id },
                data: { pfcDetailed: "GENERAL_MERCHANDISE_OTHER", categorySource: "user" },
              });
            }
            return result;
          };
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await reapplyRules(user.id, { client: racing })).toBe(0);
    expect(edited).toBe(true);
    const after = await client.transaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.pfcDetailed).toBe("GENERAL_MERCHANDISE_OTHER");
    expect(after.categorySource).toBe("user");
  });

  // Founder 10-30: a prop firm's payout the bank or Claude called a transfer is income; the
  // person's own label stays. Made-up rows.
  it("moves a payout others filed as a transfer to income, never the person's own", async () => {
    const user = await client.user.create({
      data: { email: `reapply-${crypto.randomUUID()}@example.com` },
    });
    users.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    let n = 0;
    const payout = (categorySource: "plaid" | "llm" | "user", amountCents = -150_000) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: `p${n++}`,
          date: new Date("2026-10-01"),
          amountCents,
          description: "LUCID TRADING PAYOUT ACH CREDIT",
          pfcPrimary: "TRANSFER_IN",
          pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
          categorySource,
        },
      });
    const bank = await payout("plaid");
    const claude = await payout("llm");
    const mine = await payout("user");

    expect(await reapplyRules(user.id, { client })).toBe(2);
    const of = (id: string) =>
      client.transaction.findUniqueOrThrow({
        where: { id },
        select: { pfcPrimary: true, pfcDetailed: true, categorySource: true },
      });
    const income = {
      pfcPrimary: "INCOME",
      pfcDetailed: "INCOME_CONTRACTOR",
      categorySource: "rule",
    };
    expect(await of(bank.id)).toEqual(income);
    expect(await of(claude.id)).toEqual(income);
    expect((await of(mine.id)).pfcDetailed).toBe("TRANSFER_IN_ACCOUNT_TRANSFER");
  });
});
