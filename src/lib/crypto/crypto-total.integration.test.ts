import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { cryptoTotal, linkDemoCrypto, syncAllCrypto } from "./crypto";

// CodeRabbit sweep (fin-01): sample coins linked while the person had only the demo bank must not
// stay in their net worth once a real account is added.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");

describe.runIf(url)("net worth's crypto after a real bank is added", () => {
  let client: PrismaClient;
  const people: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("counts the demo coins for a demo-bank person and leaves them out once real data exists", async () => {
    const { id } = await client.user.create({
      data: { email: `crypto-total-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    const { itemId } = await linkDemoBank(id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    await linkDemoCrypto(id, "exchange", { client, now: NOW });
    expect(await cryptoTotal(id, { client })).toBeGreaterThan(0);

    await client.account.create({
      data: { userId: id, source: "csv", name: "Real checking", type: "depository" },
    });
    // The person's reads are cached per request; this is a fresh one.
    expect(await cryptoTotal(id, { client })).toBe(0);
  });

  // CodeRabbit sweep (fin-01): the nightly run reached only the first 500 people.
  it("reaches every person with a connection, page after page", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { id } = await client.user.create({
        data: { email: `crypto-page-${crypto.randomUUID()}@example.com` },
      });
      people.push(id);
      ids.push(id);
      await client.cryptoConnection.create({
        data: { userId: id, kind: "wallet", name: "Wallet", partner: "none" },
      });
    }
    const result = await syncAllCrypto({ client, now: NOW, userIds: ids, pageSize: 2 });
    expect(result.people).toBe(5);
  });
});
