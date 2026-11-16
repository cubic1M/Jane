import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { encrypt } from "@/lib/crypto";
import { loadInvestments } from "@/lib/investments/holdings";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate B, "one number, one source" (docs/one-number.md): the Investing page's total says it's "the
// same as in your net worth", so it is: what net worth counts as invested, for every sample person
// on the demo bank and for a brokerage linked twice, which the Investing page counted twice.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T17:00:00Z");

describe.runIf(url)("investments, one number", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const user = async (name: string) => {
    const row = await client.user.create({
      data: { email: `one-number-inv-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };
  const sameAsNetWorth = async (userId: string) => {
    const o = { client, now: NOW };
    const [investing, money] = await Promise.all([
      loadInvestments(userId, o),
      loadMoneyArea(userId, o),
    ]);
    expect(investing.totalCents).toBe(money!.have.investmentsCents);
    return investing.totalCents;
  };

  it.each(PEOPLE.map((p) => p.id))("%s: the Investing total is net worth's", async (id) => {
    const userId = await user(id);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    await sameAsNetWorth(userId);
  });

  it("counts a brokerage linked twice once", async () => {
    const userId = await user("relinked");
    const item = async (n: string) =>
      (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId: `item-inv-${n}`,
            accessTokenEncrypted: encrypt(`access-inv-${n}`),
            institutionName: "Fidelity",
          },
        })
      ).id;
    for (const [n, itemId] of [
      ["first", await item("first")],
      ["again", await item("again")],
    ]) {
      await client.account.create({
        data: {
          userId,
          itemId,
          source: "plaid",
          plaidAccountId: `inv-${n}`,
          name: "Brokerage",
          mask: "7777",
          type: "investment",
          subtype: "brokerage",
          currentBalanceCents: 1_250_000,
        },
      });
    }
    expect(await sameAsNetWorth(userId)).toBe(1_250_000);
  });
});
