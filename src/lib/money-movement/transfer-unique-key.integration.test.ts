import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import type { MoneyMovementPartner } from "./partner";
import { cancelTransfer, scheduleTransfer, settleTransfers } from "./transfers";

// CodeRabbit sweep part 4 (P4-O18): a plan that is tried twice (a retry, two taps at once) must
// not schedule the same money twice. money_transfers.unique_key holds one transfer per move.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T15:00:00Z");

describe.runIf(url)("one transfer for one move of a plan", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  let from = "";
  let to = "";
  const api = new Proxy({}, { get: () => () => {} }) as PlaidApi;

  const partnerOf = (calls: { n: number }, fail = false): MoneyMovementPartner => ({
    name: "Test partner",
    simulated: true,
    async schedule() {
      calls.n += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (fail) throw new Error("partner down");
      return { partnerRef: `REF-${calls.n}` };
    },
    async cancel() {
      return true;
    },
    async settled({ runOn }, today) {
      return runOn <= today;
    },
  });

  const move = (key: string | null) => ({
    fromAccountId: from,
    toAccountId: to,
    toName: "Savings",
    amountCents: 10_000,
    purpose: "cash" as const,
    sector: "goals" as const,
    planKey: "paycheck:test",
    uniqueKey: key,
  });

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `uniquekey-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW }).catch(() => undefined);
    const accounts = await client.account.findMany({ where: { userId }, orderBy: { id: "asc" } });
    from = accounts[0]!.id;
    to = accounts[1]!.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("schedules the same move once when asked twice at the same moment", async () => {
    const calls = { n: 0 };
    const partner = partnerOf(calls);
    const [a, b] = await Promise.all([
      scheduleTransfer(userId, move("paycheck:test|goal|a"), "autopilot", {
        client,
        now: NOW,
        partner,
      }),
      scheduleTransfer(userId, move("paycheck:test|goal|a"), "person", {
        client,
        now: NOW,
        partner,
      }),
    ]);
    expect(a.id).toBe(b.id);
    expect(calls.n).toBe(1);
    expect(
      await client.moneyTransfer.count({ where: { userId, uniqueKey: "paycheck:test|goal|a" } }),
    ).toBe(1);
    const row = await client.moneyTransfer.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.partnerRef).toBe("REF-1");
  });

  it("keeps a move without a key as it was: two calls, two transfers", async () => {
    const calls = { n: 0 };
    const partner = partnerOf(calls);
    await scheduleTransfer(userId, move(null), "person", { client, now: NOW, partner });
    await scheduleTransfer(userId, move(null), "person", { client, now: NOW, partner });
    expect(calls.n).toBe(2);
  });

  it("frees the key when the partner fails, so the move can be tried again", async () => {
    const down = partnerOf({ n: 0 }, true);
    await expect(
      scheduleTransfer(userId, move("paycheck:test|goal|b"), "person", {
        client,
        now: NOW,
        partner: down,
      }),
    ).rejects.toThrow("partner down");
    const calls = { n: 0 };
    const again = await scheduleTransfer(userId, move("paycheck:test|goal|b"), "person", {
      client,
      now: NOW,
      partner: partnerOf(calls),
    });
    expect(calls.n).toBe(1);
    expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id: again.id } })).status).toBe(
      "pending",
    );
  });

  it("frees the key when the transfer is undone", async () => {
    const calls = { n: 0 };
    const partner = partnerOf(calls);
    const first = await scheduleTransfer(userId, move("paycheck:test|goal|c"), "person", {
      client,
      now: NOW,
      partner,
    });
    await cancelTransfer(userId, first.id, { client, now: NOW, partner });
    const second = await scheduleTransfer(userId, move("paycheck:test|goal|c"), "person", {
      client,
      now: NOW,
      partner,
    });
    expect(second.id).not.toBe(first.id);
  });

  it("leaves a move still waiting on the partner call alone, and fails one that never reached it", async () => {
    const calls = { n: 0 };
    const row = await client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: from,
        toAccountId: to,
        toName: "Savings",
        amountCents: 5_000,
        purpose: "cash",
        sector: "goals",
        runOn: new Date("2026-10-16T00:00:00Z"),
        partner: "Test partner",
        by: "person",
        uniqueKey: "paycheck:test|goal|d",
        createdAt: new Date("2026-10-17T14:50:00Z"),
      },
    });
    await settleTransfers(userId, { client, now: NOW, partner: partnerOf(calls) });
    expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "pending",
    );
    const later = new Date("2026-10-17T17:00:00Z");
    await settleTransfers(userId, { client, now: later, partner: partnerOf(calls) });
    const failed = await client.moneyTransfer.findUniqueOrThrow({ where: { id: row.id } });
    expect(failed.status).toBe("failed");
    expect(failed.uniqueKey).toBeNull();
  });
});
