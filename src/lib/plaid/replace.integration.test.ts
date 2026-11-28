import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import {
  plaidAccount,
  plaidApiError,
  plaidTransaction,
  syncPage,
} from "@/data-sources/plaid/__fixtures__/plaid";
import { decrypt, encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { ReplaceRefused, removeLeftoverReplaced, replaceWithFullHistory } from "./replace";
import { syncItem } from "./sync";

// Against a real, migrated Postgres, with Plaid's API mocked (see history.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T12:00:00Z");
const OLD_TOKEN = "access-sandbox-old-link";
const NEW_TOKEN = "access-sandbox-new-link";

describe.runIf(url)("one tap for the full history, nothing lost", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let oldItem: string;
  let oldAccount: string;
  const acc = `${suffix}-old-acc`;
  const newAcc = `${suffix}-new-acc`;
  const exchange = vi.fn();
  const itemRemove = vi.fn();
  const accountsGet = vi.fn();
  const transactionsSync = vi.fn();
  const recurringGet = vi.fn();
  const api = {
    itemPublicTokenExchange: exchange,
    itemRemove,
    itemGet: vi.fn().mockResolvedValue({ data: { item: { institution_id: "ins_1" } } }),
    accountsGet,
    transactionsSync,
    transactionsRecurringGet: recurringGet,
  } as unknown as PlaidApi;
  const sleep = async () => {};

  const bankAccount = (id: string, over: object = {}) => plaidAccount({ account_id: id, ...over });
  const tx = (id: string, date: string, over: object = {}) => ({
    ...plaidTransaction({
      transaction_id: id,
      date,
      amount: 20,
      name: `SHOP ${date}`,
      merchant_name: null,
      personal_finance_category: undefined,
      ...over,
    }),
    account_id: newAcc,
  });
  const recent = ["2026-10-19", "2026-10-29", "2026-11-08"];
  const older = ["2025-12-05", "2026-01-05", "2026-02-05", "2026-03-05"];
  const fullHistory = () =>
    syncPage({
      accounts: [bankAccount(newAcc)],
      added: [
        ...recent.map((d, i) => tx(`${suffix}-new-r${i}`, d)),
        ...older.map((d, i) => tx(`${suffix}-new-o${i}`, d)),
      ],
      next_cursor: "new-cursor",
      status: "HISTORICAL_UPDATE_COMPLETE",
    });
  const sum = async () =>
    (
      await client.account.aggregate({
        where: { userId },
        _sum: { currentBalanceCents: true },
      })
    )._sum.currentBalanceCents;
  const run = (token = "public-sandbox-x", name: string | null = "Slow Platypus Bank") =>
    replaceWithFullHistory(userId, oldItem, token, name, { client, api, sleep }, NOW);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `replace-${suffix}@example.com` } })).id;
  });

  // The audit rows about this suite's links, and only those.
  const forgetAudit = async () => {
    const ids = [
      ...(await client.plaidItem.findMany({ where: { userId }, select: { id: true } })).map(
        (i) => i.id,
      ),
      ...made,
    ];
    await client.auditLog.deleteMany({
      where: { event: { startsWith: "plaid_history" }, targetId: { in: ids } },
    });
  };
  const made: string[] = [];

  afterAll(async () => {
    await forgetAudit();
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // A link made Oct 1 that asked for a year, holds only from Oct 19, is complete at Plaid and was read
  // again from the start: the one tap is on offer. The person set a category on one charge and a
  // balance snapshot exists.
  beforeEach(async () => {
    exchange.mockReset().mockResolvedValue({
      data: { access_token: NEW_TOKEN, item_id: `${suffix}-new-item` },
    });
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    accountsGet.mockReset().mockResolvedValue({ data: { accounts: [bankAccount(newAcc)] } });
    transactionsSync.mockReset().mockResolvedValue(fullHistory());

    await forgetAudit();
    await client.plaidItem.deleteMany({ where: { userId } });
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `${suffix}-old-item`,
        accessTokenEncrypted: encrypt(OLD_TOKEN),
        institutionName: "Slow Platypus Bank",
        transactionsCursor: "old-cursor",
        createdAt: new Date("2026-10-01T12:00:00Z"),
      },
    });
    oldItem = item.id;
    made.push(oldItem);
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId: oldItem,
        plaidAccountId: acc,
        name: "Plaid Checking",
        mask: "0000",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 123456,
      },
    });
    oldAccount = account.id;
    await client.balanceSnapshot.createMany({
      data: [
        { userId, accountId: oldAccount, date: new Date("2026-11-01"), balanceCents: 100000 },
        { userId, accountId: oldAccount, date: new Date("2026-11-20"), balanceCents: 123456 },
      ],
    });
    await client.transaction.createMany({
      data: recent.map((d, i) => ({
        userId,
        accountId: oldAccount,
        source: "plaid" as const,
        plaidTransactionId: `${suffix}-old-r${i}`,
        date: new Date(d),
        amountCents: 2000,
        description: `SHOP ${d}`,
        // The middle one is the person's own.
        ...(i === 1
          ? {
              pfcPrimary: "ENTERTAINMENT",
              pfcDetailed: "ENTERTAINMENT_OTHER",
              categorySource: "user" as const,
            }
          : {}),
      })),
    });
    await client.auditLog.create({
      data: {
        actorType: "system",
        event: "plaid_history_checked",
        targetType: "plaid_item",
        targetId: oldItem,
        metadata: {
          status: "HISTORICAL_UPDATE_COMPLETE",
          daysRequested: 365,
          earliest: "2026-10-19",
          latest: "2026-11-08",
          count: 3,
          cursorMovedAt: null,
          rescannedAt: "2026-11-20T00:00:00.000Z",
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves everything onto the new link and removes the old one; categories, snapshots and net worth are kept", async () => {
    const before = await sum();
    const result = await run();
    expect(result).toMatchObject({ accounts: 1, twins: 3, added: 4, oldRemoved: true });

    // One account, the same row, on the new link and its account id.
    const accounts = await client.account.findMany({ where: { userId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: oldAccount, plaidAccountId: newAcc });
    const items = await client.plaidItem.findMany({ where: { userId } });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(result.itemId);
    expect(items[0]).toMatchObject({ status: "active", transactionsCursor: "new-cursor" });
    expect(decrypt(items[0].accessTokenEncrypted)).toBe(NEW_TOKEN);
    expect(accounts[0].itemId).toBe(items[0].id);

    // Net worth to the cent, and both snapshots still there.
    expect(await sum()).toBe(before);
    expect(await client.balanceSnapshot.count({ where: { accountId: oldAccount } })).toBe(2);

    // Seven transactions, none twice; the three old ones took the new ids; the category survived.
    const rows = await client.transaction.findMany({ where: { userId }, orderBy: { date: "asc" } });
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.plaidTransactionId)).size).toBe(7);
    const edited = rows.find((r) => r.date.toISOString().startsWith("2026-10-29"))!;
    expect(edited).toMatchObject({
      plaidTransactionId: `${suffix}-new-r1`,
      pfcPrimary: "ENTERTAINMENT",
      categorySource: "user",
    });
    expect(rows[0].date.toISOString().slice(0, 10)).toBe("2025-12-05");

    // The old link was removed at Plaid with its own token, never the new one.
    expect(itemRemove).toHaveBeenCalledTimes(1);
    expect(itemRemove.mock.calls[0][0].access_token).toBe(OLD_TOKEN);
    // Counts only in the record.
    const written = await client.auditLog.findFirstOrThrow({
      where: { event: "plaid_history_replaced", targetId: result.itemId },
    });
    expect(JSON.stringify(written.metadata)).not.toContain("access-");
    expect(written.metadata).toMatchObject({ twins: 3, added: 4, kept: 0, oldRemoved: true });
  });

  it("keeps an old row older than the new read, and adds the new ones", async () => {
    // Older than anything the new read has (it starts 2025-12-05): the new read says nothing about it.
    await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-old-lonely`,
        date: new Date("2025-12-01"),
        amountCents: 999,
        description: "ONLY AT THE OLD LINK",
      },
    });
    const result = await run();
    expect(result.kept).toBe(1);
    expect(
      await client.transaction.count({
        where: { userId, plaidTransactionId: `${suffix}-old-lonely` },
      }),
    ).toBe(1);
    expect(await client.transaction.count({ where: { userId } })).toBe(8);
  });

  it("carries Plaid's pending state to the twin, and drops a stale pending row that has no twin", async () => {
    await client.transaction.updateMany({
      where: { plaidTransactionId: `${suffix}-old-r0` },
      data: { pending: true },
    });
    // A pending charge at the old link that posted under another day and amount: no twin.
    const stale = await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-old-pending`,
        date: new Date("2026-11-10"),
        amountCents: 555,
        description: "PENDING THEN CHANGED",
        pending: true,
      },
    });
    // The same kind, but the person categorised it by hand: kept.
    await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-old-pending-mine`,
        date: new Date("2026-11-21"),
        amountCents: 777,
        description: "PENDING MINE",
        pending: true,
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_OTHER",
        categorySource: "user",
      },
    });
    await run();
    // The first charge posted at the bank: its twin is no longer pending.
    const posted = await client.transaction.findFirstOrThrow({
      where: { plaidTransactionId: `${suffix}-new-r0` },
    });
    expect(posted.pending).toBe(false);
    expect(await client.transaction.count({ where: { id: stale.id } })).toBe(0);
    // The person's own is kept, under a legacy-pending id (its posted charge finds it there).
    expect(
      await client.transaction.count({
        where: { plaidTransactionId: `legacy-pending:${suffix}-old-pending-mine` },
      }),
    ).toBe(1);
  });

  it("a posted charge that replaced a pending one takes its old row and the person's category", async () => {
    // At the old link: a pending dinner the person categorised.
    await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-old-dinner`,
        date: new Date("2026-11-10"),
        amountCents: 4000,
        description: "DINNER",
        pending: true,
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_RESTAURANT",
        categorySource: "user",
      },
    });
    // At the new link it posted a day later and a tip higher; the pending one is still listed.
    const pendingDinner = {
      ...tx(`${suffix}-new-dinner-p`, "2026-11-10", { name: "DINNER", amount: 40, pending: true }),
    };
    const postedDinner = {
      ...tx(`${suffix}-new-dinner`, "2026-11-11", {
        name: "DINNER",
        amount: 48,
        pending: false,
        pending_transaction_id: pendingDinner.transaction_id,
      }),
    };
    const page = fullHistory();
    page.data.added.push(pendingDinner, postedDinner);
    transactionsSync.mockReset().mockResolvedValue(page);
    await run();
    const dinner = await client.transaction.findMany({ where: { userId, description: "DINNER" } });
    expect(dinner).toHaveLength(1);
    expect(dinner[0]).toMatchObject({
      plaidTransactionId: `${suffix}-new-dinner`,
      amountCents: 4800,
      pending: false,
      pfcPrimary: "FOOD_AND_DRINK",
      categorySource: "user",
    });
    expect(dinner[0].date.toISOString().slice(0, 10)).toBe("2026-11-11");
  });

  it("answers with what committed when the clean-up afterwards fails", async () => {
    itemRemove
      .mockReset()
      .mockImplementation(async ({ access_token }: { access_token: string }) => {
        if (access_token === OLD_TOKEN) throw new Error("no answer at all");
        return { data: {} };
      });
    const result = await run();
    expect(result).toMatchObject({ accounts: 1, oldRemoved: false });
    expect(await client.account.count({ where: { userId } })).toBe(1);
  });

  it("keeps the new link, with its token, for removal when Plaid will not remove it on a failed replacement", async () => {
    accountsGet.mockResolvedValue({ data: { accounts: [bankAccount(newAcc, { mask: "9999" })] } });
    itemRemove.mockReset().mockRejectedValue(plaidApiError("INTERNAL_SERVER_ERROR", 500));
    await expect(run()).rejects.toMatchObject({ reason: "accounts_differ" });
    const left = await client.plaidItem.findMany({
      where: { userId, plaidItemId: `${suffix}-new-item` },
    });
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("replaced");
    expect(decrypt(left[0].accessTokenEncrypted)).toBe(NEW_TOKEN);
    expect(await client.account.count({ where: { itemId: left[0].id } })).toBe(0);
    // The old link is untouched; the nightly job removes the leftover.
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    await removeLeftoverReplaced({ client, api, userIds: [userId] });
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
    expect(await client.plaidItem.count({ where: { userId, status: "replaced" } })).toBe(0);
    await expectOldIntact();
  });

  it("stops removing leftovers when its time is used up", async () => {
    const ids = [] as string[];
    for (const n of [1, 2]) {
      const row = await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `${suffix}-left-${n}`,
          accessTokenEncrypted: encrypt(`access-sandbox-left-${n}`),
          status: "replaced",
        },
      });
      ids.push(row.id);
    }
    expect(await removeLeftoverReplaced({ client, api, budgetMs: -1, userIds: [userId] })).toBe(0);
    expect(itemRemove).not.toHaveBeenCalled();
    expect(await removeLeftoverReplaced({ client, api, userIds: [userId] })).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("refuses when the new link shares other accounts: the old link is untouched, the new one removed", async () => {
    accountsGet.mockResolvedValue({
      data: { accounts: [bankAccount(newAcc, { mask: "9999" })] },
    });
    await expect(run()).rejects.toMatchObject({ reason: "accounts_differ" });
    await expectOldIntact();
    expect(itemRemove).toHaveBeenCalledTimes(1);
    expect(itemRemove.mock.calls[0][0].access_token).toBe(NEW_TOKEN);
    expect(await client.plaidItem.count({ where: { plaidItemId: `${suffix}-new-item` } })).toBe(0);
  });

  it("refuses when two new accounts fit one old one", async () => {
    accountsGet.mockResolvedValue({
      data: { accounts: [bankAccount(newAcc), bankAccount(`${newAcc}-2`)] },
    });
    await expect(run()).rejects.toBeInstanceOf(ReplaceRefused);
    await expectOldIntact();
  });

  it("rolls everything back when saving fails after the exchange", async () => {
    // The new Item's id is already taken, so the save inside the transaction fails.
    const other = await client.user.create({ data: { email: `other-${suffix}@example.com` } });
    await client.plaidItem.create({
      data: {
        userId: other.id,
        plaidItemId: `${suffix}-new-item`,
        accessTokenEncrypted: encrypt("access-sandbox-someone-else"),
      },
    });
    try {
      await expect(run()).rejects.toThrow();
      await expectOldIntact();
      expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
    } finally {
      await client.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("rolls back when Plaid fails while reading the new link", async () => {
    transactionsSync.mockReset().mockRejectedValue(plaidApiError("ITEM_LOGIN_REQUIRED"));
    await expect(run()).rejects.toThrow();
    await expectOldIntact();
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
  });

  it("gives up, changing nothing, when Plaid never calls the new history complete", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [bankAccount(newAcc)],
        added: [],
        next_cursor: "slow",
        status: "INITIAL_UPDATE_COMPLETE",
      }),
    );
    const slowSleep = async (ms: number) => {
      vi.setSystemTime(Date.now() + ms * 6);
    };
    await expect(
      replaceWithFullHistory(
        userId,
        oldItem,
        "public-sandbox-x",
        null,
        { client, api, sleep: slowSleep },
        NOW,
      ),
    ).rejects.toMatchObject({ reason: "not_ready" });
    await expectOldIntact();
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
  });

  it("offers nothing and asks Plaid for nothing when the link is not short, not complete or asked for the most", async () => {
    // Not complete at Plaid yet.
    await client.auditLog.deleteMany({
      where: { event: "plaid_history_checked", targetId: oldItem },
    });
    await expect(run()).rejects.toMatchObject({ reason: "not_offered" });
    expect(exchange).not.toHaveBeenCalled();
    // Another person's link, or one that does not exist.
    await expect(
      replaceWithFullHistory(userId, "nope", "public-sandbox-x", null, { client, api, sleep }, NOW),
    ).rejects.toMatchObject({ reason: "not_offered" });
    // A different bank.
    await client.auditLog.create({
      data: {
        actorType: "system",
        event: "plaid_history_checked",
        targetType: "plaid_item",
        targetId: oldItem,
        metadata: {
          status: "HISTORICAL_UPDATE_COMPLETE",
          daysRequested: 365,
          earliest: "2026-10-19",
          latest: "2026-11-08",
          count: 3,
          cursorMovedAt: null,
          rescannedAt: "2026-11-20T00:00:00.000Z",
        },
      },
    });
    await expect(run("public-sandbox-x", "Some Other Bank")).rejects.toMatchObject({
      reason: "different_bank",
    });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("a second tap at the same time cannot also move the accounts", async () => {
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await client.account.count({ where: { userId } })).toBe(1);
    expect(await client.transaction.count({ where: { userId } })).toBe(7);
    expect(await client.plaidItem.count({ where: { userId } })).toBe(1);
  });

  it("a sync that was already saving when the link was replaced leaves no second copy of the accounts", async () => {
    // The old link is replaced while its sync is still saving under the old Plaid ids: the recurring
    // read, which comes after the accounts and rows are saved, is where the replacement lands.
    const stray = `${suffix}-stray-acc`;
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [bankAccount(stray, { mask: "7777" })],
        added: [{ ...tx(`${suffix}-stray-t`, "2026-11-12"), account_id: stray }],
        next_cursor: "stray-cursor",
      }),
    );
    recurringGet.mockReset().mockImplementation(async () => {
      // What the replacement does: a new link takes the real account, the old one is marked replaced.
      const fuller = await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `${suffix}-fuller`,
          accessTokenEncrypted: encrypt("access-sandbox-fuller"),
        },
      });
      await client.account.update({ where: { id: oldAccount }, data: { itemId: fuller.id } });
      await client.plaidItem.update({ where: { id: oldItem }, data: { status: "replaced" } });
      return { data: { outflow_streams: [], inflow_streams: [] } };
    });
    await expect(syncItem(oldItem, { client, api, now: NOW })).rejects.toThrow("replaced");
    expect(await client.account.count({ where: { plaidAccountId: stray } })).toBe(0);
    expect(
      await client.transaction.count({ where: { plaidTransactionId: `${suffix}-stray-t` } }),
    ).toBe(0);
    // The person's real account is untouched.
    expect(await client.account.count({ where: { id: oldAccount } })).toBe(1);
  });

  it("keeps a replaced link for another try when Plaid will not remove it, hidden and never synced", async () => {
    itemRemove
      .mockReset()
      .mockImplementation(async ({ access_token }: { access_token: string }) => {
        if (access_token === OLD_TOKEN) throw plaidApiError("INTERNAL_SERVER_ERROR", 500);
        return { data: {} };
      });
    const result = await run();
    expect(result.oldRemoved).toBe(false);
    const left = await client.plaidItem.findMany({ where: { userId, status: "replaced" } });
    expect(left).toHaveLength(1);
    expect(await client.account.count({ where: { itemId: left[0].id } })).toBe(0);
    // Never synced, whoever asks (a webhook, the nightly job, a sync that was already running).
    await expect(syncItem(left[0].id, { client, api })).rejects.toThrow("replaced");
    // The nightly job's second try.
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    expect(await removeLeftoverReplaced({ client, api, userIds: [userId] })).toBeGreaterThanOrEqual(
      1,
    );
    expect(await client.plaidItem.count({ where: { userId, status: "replaced" } })).toBe(0);
    expect(await client.account.count({ where: { userId } })).toBe(1);
    void scopedFor;
  });

  async function expectOldIntact() {
    const item = await client.plaidItem.findUniqueOrThrow({ where: { id: oldItem } });
    expect(item).toMatchObject({ status: "active", transactionsCursor: "old-cursor" });
    expect(decrypt(item.accessTokenEncrypted)).toBe(OLD_TOKEN);
    const accounts = await client.account.findMany({ where: { userId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: oldAccount, itemId: oldItem, plaidAccountId: acc });
    const rows = await client.transaction.findMany({ where: { userId } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.plaidTransactionId?.startsWith(`${suffix}-old-`))).toBe(true);
    expect(await client.plaidItem.count({ where: { userId } })).toBe(1);
    expect(await client.balanceSnapshot.count({ where: { accountId: oldAccount } })).toBe(2);
    expect(await sum()).toBe(123456);
  }
});
