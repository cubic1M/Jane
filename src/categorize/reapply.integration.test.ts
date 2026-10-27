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
});
