import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

// A hook the test can set to run in the middle of a sync's save (inside categorizeTransactions, which
// saveTransactions calls after the accounts are saved and before the rows are written).
const hook = vi.hoisted(() => ({ once: null as null | (() => Promise<void>) }));
vi.mock("@/categorize/categorize", async (orig) => {
  const real = await orig<typeof import("@/categorize/categorize")>();
  return {
    ...real,
    categorizeTransactions: async (...args: Parameters<typeof real.categorizeTransactions>) => {
      const run = hook.once;
      hook.once = null;
      if (run) await run();
      return real.categorizeTransactions(...args);
    },
  };
});

import { plaidAccount, plaidTransaction, syncPage } from "@/data-sources/plaid/__fixtures__/plaid";
import { PAST_BALANCE_SOURCE } from "@/config/net-worth";
import { REPLACING_STALE_MS } from "@/config/plaid";
import { decrypt, encrypt } from "@/lib/crypto";
import { loadBankNotices } from "./bank-status";
import { historyForPerson } from "./history";
import { ItemNotFoundError, markItemRepaired } from "./link";
import { rebuildPastBalances } from "./past-balances";
import { planWebhook } from "./webhooks";
import { removeLeftoverReplaced, replaceWithFullHistory } from "./replace";
import { syncItem } from "./sync";
import { removeOrphans } from "@/lib/evidence/orphans";

// The faults an independent review proved in PR #2407 (F1 to F4 below carry the review's own tests, the
// ones after them prove the fixes and the claims the review found untested). Each test states a claim
// and fails if the claim is false.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T12:00:00Z");
const OLD_TOKEN = "access-sandbox-old-link";
const NEW_TOKEN = "access-sandbox-new-link";

describe.runIf(url)("second review of #2407", () => {
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

  const tx = (id: string, date: string, over: object = {}, account = newAcc) => ({
    ...plaidTransaction({
      transaction_id: id,
      date,
      amount: 20,
      name: `SHOP ${date}`,
      merchant_name: null,
      personal_finance_category: undefined,
      ...over,
    }),
    account_id: account,
  });
  const recent = ["2026-10-19", "2026-10-29", "2026-11-08"];
  const fullAdded = (extra: object[] = [], rename = false) => [
    ...recent.map((d, i) =>
      tx(`${suffix}-new-r${i}`, d, rename && i === 0 ? { name: `SHOP ${d} #4411` } : {}),
    ),
    ...extra,
  ];
  const full = (added: object[]) =>
    syncPage({
      accounts: [plaidAccount({ account_id: newAcc })],
      added: added as never,
      next_cursor: "new-cursor",
      status: "HISTORICAL_UPDATE_COMPLETE",
    });
  const run = (publicSleep: (ms: number) => Promise<void> = sleep) =>
    replaceWithFullHistory(
      userId,
      oldItem,
      "public-sandbox-x",
      "Slow Platypus Bank",
      { client, api, sleep: publicSleep },
      NOW,
    );

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `review2-${suffix}@example.com` } })).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    hook.once = null;
    exchange.mockReset().mockResolvedValue({
      data: { access_token: NEW_TOKEN, item_id: `${suffix}-new-item` },
    });
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    accountsGet.mockReset().mockResolvedValue({
      data: { accounts: [plaidAccount({ account_id: newAcc })] },
    });
    recurringGet.mockReset().mockResolvedValue({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    transactionsSync.mockReset().mockResolvedValue(full(fullAdded()));
    const mine = await client.plaidItem.findMany({ where: { userId }, select: { id: true } });
    await client.auditLog.deleteMany({
      where: { event: { startsWith: "plaid_history" }, targetId: { in: mine.map((i) => i.id) } },
    });
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
    oldAccount = (
      await client.account.create({
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
      })
    ).id;
    await client.transaction.createMany({
      data: recent.map((d, i) => ({
        userId,
        accountId: oldAccount,
        source: "plaid" as const,
        plaidTransactionId: `${suffix}-old-r${i}`,
        date: new Date(d),
        amountCents: 2000,
        description: `SHOP ${d}`,
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

  // ---------------------------------------------------------------------------------------------
  // The fixes for the four faults above, and what the review said had no test.
  // ---------------------------------------------------------------------------------------------
  const newClient = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const households: string[] = [];
  const oldRow = (key: string, date: string, cents: number, over: object = {}) =>
    client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-${key}`,
        date: new Date(date),
        amountCents: cents,
        description: `OLD ${key}`,
        ...over,
      },
    });
  const rowsOn = (day: string, cents: number) =>
    client.transaction.findMany({ where: { userId, date: new Date(day), amountCents: cents } });
  const oldIntact = async () => {
    expect((await client.plaidItem.findUniqueOrThrow({ where: { id: oldItem } })).status).toBe(
      "active",
    );
    expect(await client.account.count({ where: { userId, itemId: oldItem } })).toBe(1);
    expect(await client.plaidItem.count({ where: { plaidItemId: `${suffix}-new-item` } })).toBe(0);
  };

  afterEach(async () => {
    vi.useRealTimers();
    await client.goalTransfer.deleteMany({ where: { userId } });
    await client.household.deleteMany({ where: { id: { in: households.splice(0) } } });
  });

  // S1 (major): hangs-on.ts protects the tables the PR's list names, but a confirmed saving names the
  // charges that prove it by id (SuggestionOutcome.evidenceTxIds / heldEvidenceTxIds), and so do
  // MonthClose.uncertain and unusual-activity alerts (a plain id, no foreign key). A row dropped by the
  // move takes its id with it, even when the charge itself is still there under a new row (here the new
  // read dates it five days later, past the three-day twin slack): the next removeOrphans, which runs
  // after every sync, deletes the line from the person's verified-savings record.
  // Decision after this review: a posted charge is never deleted. The new read dates the charge five days
  // later (no twin), so the move REFUSES; nothing is written, the saving's evidence is exactly where it was.
  it("S1: a confirmed saving keeps the charge that proves it; the move refuses when the new read dates that charge five days later", async () => {
    const proof = await oldRow("proof", "2026-11-01", 1599, { description: "STREAMING CO" });
    const key = `cancel-${suffix}`;
    await client.suggestionOutcome.create({
      data: {
        userId,
        suggestionKey: key,
        capability: "subscriptions",
        topic: "subscriptions",
        title: "Cancel the streaming plan",
        firstShownAt: NOW,
        lastShownAt: NOW,
        expectedCents: 19188,
        worthKind: "saving",
        confidencePercent: 90,
        status: "confirmed",
        confirmedCents: 19188,
        evidenceTxIds: [proof.id],
      },
    });
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded([
            tx(`${suffix}-new-proof`, "2026-11-06", { name: "STREAMING CO", amount: 15.99 }),
          ]),
        ),
      );
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    await removeOrphans(userId, { client });
    // The charge is still there as the same row and the saving the person was shown is still theirs.
    const rows = await client.transaction.findMany({ where: { userId, amountCents: 1599 } });
    expect(rows.map((r) => r.id)).toEqual([proof.id]);
    expect(rows[0].plaidTransactionId).toBe(`${suffix}-proof`);
    expect(await client.suggestionOutcome.count({ where: { userId, suggestionKey: key } })).toBe(1);
    expect(await client.plaidItem.count({ where: { plaidItemId: `${suffix}-new-item` } })).toBe(0);
  });

  // S2 (minor): the person is told "The team has been told", and nothing tells the team.
  it("S2: a refusal for read_differs leaves a record the team can see", async () => {
    const since = new Date(Date.now() - 1000);
    const opsBefore = await client.opsEvent.count({ where: { kind: "plaid_history_refused" } });
    for (let i = 0; i < 30; i += 1) await oldRow(`bulk${i}`, "2026-10-25", 5000 + i);
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    const audit = await client.auditLog.count({
      where: {
        targetId: oldItem,
        event: { not: "plaid_history_checked" },
        createdAt: { gte: since },
      },
    });
    const ops = await client.opsEvent.count({ where: { kind: "plaid_history_refused" } });
    expect(audit).toBeGreaterThan(0);
    expect(ops).toBe(opsBefore + 1);
  });

  // S3 (minor): a pending charge kept for a day has no way to meet its posted charge when the bank words
  // them differently, so it is there twice until it is ten days old.
  it("S3: a kept pending charge and its posted charge, worded differently, are one charge", async () => {
    await oldRow("ghost", "2026-11-26", 2000, { description: "AMZN MKTP US", pending: true });
    await run();
    const fresh = await client.plaidItem.findFirstOrThrow({
      where: { userId, plaidItemId: `${suffix}-new-item` },
    });
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [plaidAccount({ account_id: newAcc })],
        added: [
          tx(`${suffix}-posted`, "2026-11-27", {
            name: "AMAZON MARKETPLACE",
            amount: 20,
            pending: false,
            pending_transaction_id: `${suffix}-never-seen`,
          }),
        ] as never,
        next_cursor: "new-cursor-2",
        status: "HISTORICAL_UPDATE_COMPLETE",
      }),
    );
    await syncItem(fresh.id, { client, api, now: NOW });
    expect(
      await client.transaction.count({
        where: { userId, amountCents: 2000, date: { gte: new Date("2026-11-20") } },
      }),
    ).toBe(1);
  });

  // S4 (major): the new read is taken as the truth for every day between its first and last charge, so a
  // hole in it (a fortnight of one account that Plaid has not filled) removes every old charge in the hole,
  // as long as it is not both more than 25 and more than 20% of all the old rows. The old Item is removed
  // at Plaid right after, so nothing can bring them back.
  it("S4: a hole in the new read refuses the move: no charge is deleted, the old link stays, the new Item is removed", async () => {
    const base = Array.from({ length: 200 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 1, 1 + i)).toISOString().slice(0, 10);
      return { i, day };
    });
    await client.transaction.createMany({
      data: base.map(({ i, day }) => ({
        userId,
        accountId: oldAccount,
        source: "plaid" as const,
        plaidTransactionId: `${suffix}-base${i}`,
        date: new Date(day),
        amountCents: 2000,
        description: `BASE ${i}`,
      })),
    });
    await client.transaction.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        userId,
        accountId: oldAccount,
        source: "plaid" as const,
        plaidTransactionId: `${suffix}-gap${i}`,
        date: new Date(Date.UTC(2026, 9, 20 + (i % 9))),
        amountCents: 3000 + i,
        description: `GAP ${i}`,
      })),
    });
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded(
            base.map(({ i, day }) =>
              tx(`${suffix}-new-base${i}`, day, { name: `BASE ${i}`, amount: 20 }),
            ),
          ),
        ),
      );
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    expect(
      await client.transaction.count({ where: { userId, description: { startsWith: "GAP " } } }),
    ).toBe(40);
    expect(await client.transaction.count({ where: { userId } })).toBe(243);
    expect((await client.plaidItem.findUniqueOrThrow({ where: { id: oldItem } })).status).toBe(
      "active",
    );
    expect(await client.plaidItem.count({ where: { plaidItemId: `${suffix}-new-item` } })).toBe(0);
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
  });
});
