import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CLAIM_LEASE_MS } from "@/config/money-movement";
import type { PlaidApi } from "plaid";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import type { MoneyMovementPartner } from "./partner";
import { movePaycheckPlan, PaycheckError } from "./paycheck";
import { settleTransfers } from "./transfers";

// CodeRabbit sweep part 4 (P4-O18): a "releasing" transfer and a "moving" paycheck plan are
// claims a run takes before it moves money. A claim has a lease: one another run still holds is
// left to it, one past its end is taken over (before, a releasing claim was taken by any run, and
// a moving plan that lost its tap stayed moving for ever).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T15:00:00Z");
const PAST = new Date(NOW.getTime() - 60_000);
const AHEAD = new Date(NOW.getTime() + CLAIM_LEASE_MS / 2);

describe.runIf(url)("claims on money that moves have a lease", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  let from = "";
  let to = "";
  const released: string[] = [];

  const partner: MoneyMovementPartner = {
    name: "Test partner",
    simulated: true,
    async schedule() {
      return { partnerRef: "REF" };
    },
    async cancel() {
      return true;
    },
    async settled() {
      return true;
    },
    async release(partnerRef) {
      released.push(partnerRef);
      return { partnerRef };
    },
  };

  const transfer = (partnerRef: string, claimExpiresAt: Date | null) =>
    client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: from,
        toAccountId: to,
        toName: "Savings",
        amountCents: 5_000,
        purpose: "cash",
        sector: "goals",
        status: "releasing",
        runOn: new Date("2026-10-16T00:00:00Z"),
        partner: "Test partner",
        partnerRef,
        by: "autopilot",
        claimExpiresAt,
      },
    });

  const plan = (key: string, claimExpiresAt: Date | null) =>
    client.paycheckPlan.create({
      data: {
        userId,
        key,
        paycheckCents: 200_000,
        paidOn: new Date("2026-10-15T00:00:00Z"),
        moves: [],
        status: "moving",
        claimExpiresAt,
      },
    });

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `lease-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    const api = new Proxy({}, { get: () => () => {} }) as PlaidApi;
    await syncItem(itemId, { client, api, now: NOW });
    const accounts = await client.account.findMany({ where: { userId }, orderBy: { id: "asc" } });
    from = accounts[0]!.id;
    to = accounts[1]!.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("leaves a transfer another run still holds, and takes over one past its lease", async () => {
    const held = await transfer("HELD", AHEAD);
    const gone = await transfer("GONE", PAST);
    const legacy = await transfer("LEGACY", null);
    await settleTransfers(userId, { client, now: NOW, partner });
    expect(released.sort()).toEqual(["GONE", "LEGACY"]);
    const status = async (id: string) =>
      (await client.moneyTransfer.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(held.id)).toBe("releasing");
    expect(await status(gone.id)).toBe("completed");
    expect(await status(legacy.id)).toBe("completed");
    expect(
      (await client.moneyTransfer.findUniqueOrThrow({ where: { id: gone.id } })).claimExpiresAt,
    ).toBeNull();
  });

  it("does not clear a claim another run took over while this one was still working", async () => {
    const row = await transfer("STALE", PAST);
    const newHolder = new Date(NOW.getTime() + CLAIM_LEASE_MS * 2);
    const slow: MoneyMovementPartner = {
      ...partner,
      async release() {
        // While this run waits on the partner, another run takes the row over.
        await client.moneyTransfer.update({
          where: { id: row.id },
          data: { claimExpiresAt: newHolder },
        });
        throw new Error("partner timed out");
      },
    };
    await expect(settleTransfers(userId, { client, now: NOW, partner: slow })).rejects.toThrow(
      "partner timed out",
    );
    const after = await client.moneyTransfer.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("releasing");
    expect(after.claimExpiresAt?.getTime()).toBe(newHolder.getTime());
  });

  it("stops a second tap on a plan a tap is still moving, and finishes one whose tap died", async () => {
    const live = await plan("paycheck:live", AHEAD);
    await expect(movePaycheckPlan(userId, live.id, { client, now: NOW, partner })).rejects.toThrow(
      PaycheckError,
    );
    expect((await client.paycheckPlan.findUniqueOrThrow({ where: { id: live.id } })).status).toBe(
      "moving",
    );
    const dead = await plan("paycheck:dead", PAST);
    await movePaycheckPlan(userId, dead.id, { client, now: NOW, partner });
    const done = await client.paycheckPlan.findUniqueOrThrow({ where: { id: dead.id } });
    expect(done.status).toBe("moved");
    expect(done.claimExpiresAt).toBeNull();
    const old = await plan("paycheck:old", null);
    await movePaycheckPlan(userId, old.id, { client, now: NOW, partner });
    expect((await client.paycheckPlan.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "moved",
    );
  });
});
