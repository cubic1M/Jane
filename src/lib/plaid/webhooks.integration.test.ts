import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { encrypt } from "@/lib/crypto";
import { firstDelivery, planWebhook, syncFromWebhook } from "./webhooks";

// Plaid's webhooks against a real, migrated Postgres: a repeated delivery is acted on once, a
// burst of syncs for one bank runs one at a time, and an account the person stops sharing
// goes with its transactions.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-26T08:00:00Z");

describe.runIf(url)("Plaid webhooks against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let itemId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `webhooks-${suffix}@example.com` } })).id;
    itemId = (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${suffix}`,
          accessTokenEncrypted: encrypt("access-sandbox-webhooks"),
          institutionName: "First Platypus Bank",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await client.plaidWebhookEvent.deleteMany({ where: { plaidItemId: `item-${suffix}` } });
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("acts on a delivery once, however often Plaid sends it", async () => {
    const body = {
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: `item-${suffix}`,
    };
    const raw = JSON.stringify(body);
    expect(await firstDelivery(raw, body, { client, now: NOW })).toBe(true);
    expect(await firstDelivery(raw, body, { client, now: NOW })).toBe(false);
    // A new event (a different body) is new.
    const later = { ...body, initial_update_complete: true };
    expect(await firstDelivery(JSON.stringify(later), later, { client, now: NOW })).toBe(true);
    expect(await client.plaidWebhookEvent.count({ where: { plaidItemId: `item-${suffix}` } })).toBe(
      2,
    );
  });

  it("runs one webhook sync at a time for a bank, and takes over one that died", async () => {
    let release!: () => void;
    const running = new Promise<void>((resolve) => (release = resolve));
    const sync = vi.fn(async () => {
      await running;
    });
    const first = syncFromWebhook(itemId, { client, now: NOW, sync });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    // A second webhook while the first sync runs: nothing more starts.
    expect(await syncFromWebhook(itemId, { client, now: NOW, sync })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(
      (await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).syncingSince,
    ).toBeNull();
    // Afterwards, the next one runs.
    expect(await syncFromWebhook(itemId, { client, now: NOW, sync })).toBe(true);

    // A sync that died long ago doesn't block the next.
    await client.plaidItem.update({
      where: { id: itemId },
      data: { syncingSince: new Date(NOW.getTime() - 60 * 60_000) },
    });
    expect(await syncFromWebhook(itemId, { client, now: NOW, sync })).toBe(true);
    // A failed sync lets go too.
    const failing = vi.fn(async () => {
      throw new Error("Plaid request failed: INSTITUTION_DOWN");
    });
    await expect(syncFromWebhook(itemId, { client, now: NOW, sync: failing })).rejects.toThrow();
    expect(
      (await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).syncingSince,
    ).toBeNull();
  });

  it("deletes an account the person stopped sharing, with its transactions", async () => {
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId,
        plaidAccountId: `acc-${suffix}`,
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "plaid",
        plaidTransactionId: `t-${suffix}`,
        date: NOW,
        amountCents: 1_000,
        description: "Coffee",
      },
    });
    await planWebhook(
      {
        webhook_type: "ITEM",
        webhook_code: "USER_ACCOUNT_REVOKED",
        item_id: `item-${suffix}`,
        account_id: `acc-${suffix}`,
      },
      { client, now: NOW },
    );
    expect(await client.account.count({ where: { id: account.id } })).toBe(0);
    expect(await client.transaction.count({ where: { plaidTransactionId: `t-${suffix}` } })).toBe(
      0,
    );
  });
});
