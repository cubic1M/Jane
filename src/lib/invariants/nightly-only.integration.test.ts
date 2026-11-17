import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { runInvariants } from "./nightly";

// Main 11-17 (run 44000445795): the card payment test read 3 legs where it had written 1, because
// another file in the same shard wrote card payments of its own while it counted everyone. A count
// for one person leaves everyone else's rows out, whatever they write meanwhile.
const url = process.env.TEST_DATABASE_URL;
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
const PAY = { pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" };

describe.runIf(url)("the nightly invariants for one person", () => {
  let client: PrismaClient;
  const made: string[] = [];

  const personWithCard = async () => {
    const user = await client.user.create({
      data: { email: `invariants-only-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    const account = (type: string) =>
      client.account.create({ data: { userId: user.id, source: "csv", name: type, type } });
    const checking = (await account("depository")).id;
    const card = (await account("credit")).id;
    const row = (accountId: string, amountCents: number, daysAgo: number) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId,
          amountCents,
          source: "csv",
          dedupeKey: crypto.randomUUID(),
          date: day(daysAgo),
          description: "MADE UP",
          ...PAY,
        },
      });
    await row(card, 500, 21);
    return { id: user.id, payFromChecking: (cents: number) => row(checking, cents, 20) };
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  it("counts only that person's card payments, not another's written meanwhile", async () => {
    const mine = await personWithCard();
    const theirs = await personWithCard();
    await mine.payFromChecking(40_000);
    const before = (await runInvariants({ client, only: mine.id })).cardPayments;
    expect(before.legs).toBe(1);

    await theirs.payFromChecking(41_000);
    await theirs.payFromChecking(42_000);
    expect((await runInvariants({ client, only: mine.id })).cardPayments).toEqual(before);
    expect((await runInvariants({ client, only: theirs.id })).cardPayments.legs).toBe(2);
  });
});
