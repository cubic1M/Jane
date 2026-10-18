import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { acceptInvite, invitePartner, leaveHousehold } from "./household";
import { SharedBillError, settleUp, sharedBills, splitCharge } from "./shared-bills";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("shared bills against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(name: string) {
    const email = `${name}-${crypto.randomUUID()}@example.com`;
    const user = await client.user.create({ data: { email } });
    created.push(user.id);
    const account = (shared: boolean) =>
      client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Checking",
          type: "depository",
          sharedWithHousehold: shared,
        },
      });
    const sharedAccount = await account(true);
    const privateAccount = await account(false);
    const charge = (accountId: string, amountCents: number) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId,
          source: "csv",
          dedupeKey: crypto.randomUUID(),
          date: new Date(),
          amountCents,
          description: "GROCER",
        },
      });
    return {
      id: user.id,
      email,
      onShared: await charge(sharedAccount.id, 10_000),
      onPrivate: await charge(privateAccount.id, 7_000),
    };
  }

  async function household() {
    const ana = await person("ana");
    const ben = await person("ben");
    const { token } = await invitePartner(ana, ben.email, { client });
    await acceptInvite(ben, token, { client });
    return { ana, ben };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("splits only charges on shared accounts, and both people see the same balance", async () => {
    const { ana, ben } = await household();
    await splitCharge(ana.id, ana.onShared.id, 5_000, { client });
    // Ben can split Ana's shared charge too, and his own.
    await splitCharge(ben.id, ben.onShared.id, 5_000, { client });

    await expect(splitCharge(ana.id, ana.onPrivate.id, 5_000, { client })).rejects.toBeInstanceOf(
      SharedBillError,
    );
    await expect(splitCharge(ana.id, ben.onPrivate.id, 5_000, { client })).rejects.toBeInstanceOf(
      SharedBillError,
    );

    // Each paid $100 and split half: all square. Change Ben's to 30% for Ana: Ben owes $20.
    expect((await sharedBills(ana.id, { client }))?.owedToMeCents).toBe(0);
    await splitCharge(ben.id, ben.onShared.id, 3_000, { client });
    expect((await sharedBills(ana.id, { client }))?.owedToMeCents).toBe(2_000);
    expect((await sharedBills(ben.id, { client }))?.owedToMeCents).toBe(-2_000);

    await settleUp(ben.id, { client });
    expect((await sharedBills(ana.id, { client }))?.owedToMeCents).toBe(0);
  });

  it("won't split without a partner, or someone outside the household", async () => {
    const loner = await person("loner");
    await expect(
      splitCharge(loner.id, loner.onShared.id, 5_000, { client }),
    ).rejects.toBeInstanceOf(SharedBillError);
    const { ana } = await household();
    await expect(splitCharge(ana.id, loner.onShared.id, 5_000, { client })).rejects.toBeInstanceOf(
      SharedBillError,
    );
  });

  it("ends the shared balance when someone leaves, keeping each person's own history", async () => {
    const { ana, ben } = await household();
    await splitCharge(ana.id, ana.onShared.id, 5_000, { client });
    await leaveHousehold(ben.id, { client });

    expect(await sharedBills(ana.id, { client })).toBeNull();
    expect(await client.sharedCharge.count({ where: { transactionId: ana.onShared.id } })).toBe(0);
    expect(await client.transaction.count({ where: { id: ana.onShared.id } })).toBe(1);
  });
});
