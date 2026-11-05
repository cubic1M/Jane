import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { encrypt } from "@/lib/crypto";
import { exchangePublicToken } from "./link";
import { reserveItemSlot } from "./item-slots";
import { syncItem } from "./sync";
import { syncFromWebhook } from "./webhooks";
import { syncedKindOf } from "@/data-sources/types";

// A read of one real bank's whole life. Nothing here has met a real bank: these are the states the
// code can be in, against Plaid's SDK comments.
const url = process.env.TEST_DATABASE_URL;

describe("Plaid's other cash accounts", () => {
  it.each([
    ["cash management", "checking"],
    ["prepaid", "checking"],
    ["money market", "savings"],
    // Money with penalties or rules on it: never told it's idle cash to move.
    ["cd", "investment_account"],
    ["hsa", "investment_account"],
  ])("keeps %s, as %s", (subtype, kind) => {
    expect(syncedKindOf("depository", subtype)).toBe(kind);
  });

  it("keeps any kind of card, and still leaves out what it can't use", () => {
    expect(syncedKindOf("credit", "paypal")).toBe("credit_card");
    expect(syncedKindOf("depository", "ebt")).toBeNull();
    expect(syncedKindOf("other", null)).toBeNull();
  });
});

describe.runIf(url)("a bank connection", () => {
  let client: PrismaClient;
  const people: string[] = [];

  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `bank-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    return id;
  };
  const item = async (userId: string, cursor: string | null = null) =>
    client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `real-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt("access-sandbox-not-real"),
        transactionsCursor: cursor,
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(() => {
    // A made-up key: only this test's own rows are sealed with it.
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("can try again after Plaid gave no clear answer", async () => {
    vi.stubEnv("PLAID_ENV", "production");
    vi.stubEnv("PLAID_ITEMS_PER_PERSON", "1");
    // The count is shared across the test database, and this isn't about the count.
    vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", "1000000");
    const userId = await person();
    const down = {
      itemPublicTokenExchange: async () => {
        throw Object.assign(new Error("timeout"), { isAxiosError: true });
      },
    } as unknown as PlaidApi;
    await expect(
      exchangePublicToken(userId, "public-x", null, { client, api: down }),
    ).rejects.toThrow();
    // Their one claim isn't spent, so "Please try again" can work.
    await expect(reserveItemSlot(userId, { client })).resolves.not.toBeNull();
    await client.plaidItemClaim.deleteMany({ where: { userId } });
    // But each try takes one of a lifetime's count, so an outage can't use them all.
    for (let tries = 0; tries < 3; tries++) {
      await exchangePublicToken(userId, "public-x", null, { client, api: down }).catch(() => {});
    }
    await expect(reserveItemSlot(userId, { client })).rejects.toThrow();
    // Only for today: an outage can't lock them out of linking for good.
    expect(await client.plaidItemClaim.count({ where: { userId } })).toBe(0);
    await client.rateLimit.deleteMany({ where: { key: `plaidUnclearExchange:${userId}` } });
    await expect(reserveItemSlot(userId, { client })).resolves.not.toBeNull();
  });

  it("syncs again when a webhook came while it was running", async () => {
    const userId = await person();
    const row = await item(userId, "c1");
    let runs = 0;
    const sync = async (itemId: string) => {
      runs += 1;
      // The historical update's webhook, arriving during the first run.
      if (runs === 1) expect(await syncFromWebhook(itemId, { client, sync })).toBe(false);
    };
    expect(await syncFromWebhook(row.id, { client, sync })).toBe(true);
    expect(runs).toBe(2);
    const after = await client.plaidItem.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.syncAgain).toBe(false);
    expect(after.syncingSince).toBeNull();
  });

  it("does no first scan on nothing, and keeps the next sync a first one", async () => {
    const userId = await person();
    const row = await item(userId);
    const nothingYet = {
      transactionsRecurringGet: async () => ({
        data: { inflow_streams: [], outflow_streams: [] },
      }),
      transactionsSync: async () => ({
        data: {
          accounts: [],
          added: [],
          modified: [],
          removed: [],
          next_cursor: "",
          has_more: false,
          transactions_update_status: "NOT_READY",
        },
      }),
    } as unknown as PlaidApi;
    const result = await syncItem(row.id, { client, api: nothingYet });
    expect(result.notReady).toBe(true);
    const after = await client.plaidItem.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.transactionsCursor).toBeNull();
    const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.firstScanDoneAt).toBeNull();
  });
});
