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
import { finishRead } from "./reread-finish";
import { removeLeftoverReplaced, replaceWithFullHistory } from "./replace";
import { syncItem } from "./sync";

// The faults an independent review proved in PR #2407 (F1 to F4 below carry the review's own tests, the
// ones after them prove the fixes and the claims the review found untested). Each test states a claim
// and fails if the claim is false.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T12:00:00Z");
const OLD_TOKEN = "access-sandbox-old-link";
const NEW_TOKEN = "access-sandbox-new-link";

describe.runIf(url)("replacing a bank link: no loss, no copy, no link left running unseen", () => {
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
    userId = (await client.user.create({ data: { email: `review-${suffix}@example.com` } })).id;
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

  // F1. "nothing is counted twice" even when the old link's sync is saving at the moment of the move.
  // The PR's repair (sync.ts: delete the accounts of the replaced link) only reaches accounts still on
  // the old link; the real accounts now belong to the new one, so the rows the late sync writes under
  // the old Plaid ids stay, and the new link's read has the same charge under its own id.
  it("F2: a sync of the old link that writes after the move leaves the charge twice", async () => {
    const coffeeOld = tx(`${suffix}-old-coffee`, "2026-11-12", { name: "COFFEE RACE" }, acc);
    const coffeeNew = tx(`${suffix}-new-coffee`, "2026-11-12", { name: "COFFEE RACE" });
    transactionsSync.mockReset().mockImplementation(async ({ access_token }) =>
      access_token === OLD_TOKEN
        ? syncPage({
            accounts: [plaidAccount({ account_id: acc })],
            added: [coffeeOld] as never,
            next_cursor: "old-cursor-2",
            status: "HISTORICAL_UPDATE_COMPLETE",
          })
        : full(fullAdded([coffeeNew])),
    );
    // The old link's sync has loaded and saved its accounts; before it writes its rows, the person's
    // one tap goes through (the new link's read already holds the same coffee under its own id).
    hook.once = async () => {
      await run();
    };
    await syncItem(oldItem, { client, api, now: NOW }).catch(() => undefined);
    const coffees = await client.transaction.findMany({
      where: { userId, description: "COFFEE RACE" },
    });
    // The move happened (the old link is gone) and the one coffee is the new link's.
    expect(coffees.map((c) => c.plaidTransactionId)).toEqual([`${suffix}-new-coffee`]);
    expect(
      (await client.plaidItem.findMany({ where: { userId } })).map((i) => i.plaidItemId),
    ).toEqual([`${suffix}-new-item`]);
  });

  // F2. "never a link left running unseen": between the exchange and the commit the new Item's token
  // is only in the function's memory. A function killed in the wait leaves a live Item no row knows.
  it("F1: while waiting for the history, the new link's token is already kept somewhere durable", async () => {
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [plaidAccount({ account_id: newAcc })],
        added: [],
        next_cursor: "slow",
        status: "INITIAL_UPDATE_COMPLETE",
      }),
    );
    let waiting!: () => void;
    const inWait = new Promise<void>((r) => (waiting = r));
    const killedHere = () => {
      waiting();
      return new Promise<void>(() => {}); // the function is killed: this never returns
    };
    const attempt = run(killedHere);
    attempt.catch(() => undefined);
    await inWait;
    // The new Item exists at Plaid (exchange was called). Is there any row that could remove it?
    expect(exchange).toHaveBeenCalledTimes(1);
    const keepers = await client.plaidItem.count({
      where: { userId, plaidItemId: `${suffix}-new-item` },
    });
    expect(keepers).toBe(1);
  });

  // F3. "nothing is counted twice": a charge whose words Plaid wrote differently on the new link has
  // no twin, so the old row stays AND the new one is added.
  it("F3: a charge the new link words differently is not counted twice", async () => {
    transactionsSync.mockReset().mockResolvedValue(full(fullAdded([], true)));
    await run();
    const onDay = await client.transaction.count({
      where: { userId, date: new Date("2026-10-19") },
    });
    expect(onDay).toBe(1);
  });

  // F4. "Jane keeps every category, note and past balance you have": a stale pending row is deleted
  // when it has no hand-set category, and a tax tag, an HSA receipt or a "not income" mark on it goes
  // with it (cascade / row delete).
  it("F4: a stale pending charge the person tagged for taxes keeps its tag", async () => {
    const pending = await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-old-pending-tagged`,
        date: new Date("2026-11-10"),
        amountCents: 555,
        description: "PENDING TAGGED",
        pending: true,
      },
    });
    await client.taxTag.create({
      data: { userId, transactionId: pending.id, tag: "business" },
    });
    await run();
    expect(await client.taxTag.count({ where: { userId } })).toBe(1);
  });

  it("F4b: a stale pending deposit the person said is not income keeps that mark", async () => {
    await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "plaid",
        plaidTransactionId: `${suffix}-old-pending-declined`,
        date: new Date("2026-11-10"),
        amountCents: -90000,
        description: "PENDING DEPOSIT",
        pending: true,
        incomePlacement: "declined",
      },
    });
    await run();
    expect(await client.transaction.count({ where: { userId, incomePlacement: "declined" } })).toBe(
      1,
    );
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

  // F1 (critical): the new Item is never only in memory.
  it("F1: the hidden row holds the new token, encrypted, until the move turns it into the link", async () => {
    const result = await run();
    const rows = await client.plaidItem.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: result.itemId, status: "active" });
    expect(rows[0].plaidItemId).toBe(`${suffix}-new-item`);
    expect(rows[0].accessTokenEncrypted).not.toContain("access-");
  });

  it("F1: a wait that is killed leaves a hidden row the nightly job removes at Plaid, once it is old", async () => {
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [plaidAccount({ account_id: newAcc })],
        added: [],
        next_cursor: "slow",
        status: "INITIAL_UPDATE_COMPLETE",
      }),
    );
    let waiting!: () => void;
    const inWait = new Promise<void>((r) => (waiting = r));
    run(() => {
      waiting();
      return new Promise<void>(() => {});
    }).catch(() => undefined);
    await inWait;
    const hidden = await client.plaidItem.findFirstOrThrow({
      where: { plaidItemId: `${suffix}-new-item` },
    });
    expect(hidden).toMatchObject({ status: "replacing", userId });
    expect(decrypt(hidden.accessTokenEncrypted)).toBe(NEW_TOKEN);
    expect(await client.account.count({ where: { itemId: hidden.id } })).toBe(0);

    // Younger than the stale age: a replacement may still be running, so it is left alone.
    itemRemove.mockClear();
    await removeLeftoverReplaced({ client, api, userIds: [userId] });
    expect(itemRemove).not.toHaveBeenCalled();
    expect(await client.plaidItem.count({ where: { id: hidden.id } })).toBe(1);

    // Older than REPLACING_STALE_MS: the function that made it is gone.
    await client.plaidItem.update({
      where: { id: hidden.id },
      data: { createdAt: new Date(Date.now() - REPLACING_STALE_MS - 60_000) },
    });
    expect(await removeLeftoverReplaced({ client, api, userIds: [userId] })).toBe(1);
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
    expect(await client.plaidItem.count({ where: { id: hidden.id } })).toBe(0);
    // The person's own link was never touched.
    await oldIntact();
  });

  it("F1: when the wait is refused the new Item goes at Plaid, then its row; if Plaid will not, the row stays for the night", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [plaidAccount({ account_id: newAcc })],
        added: [],
        next_cursor: "slow",
        status: "INITIAL_UPDATE_COMPLETE",
      }),
    );
    const slow = async (ms: number) => {
      vi.setSystemTime(Date.now() + ms * 6);
    };
    await expect(run(slow)).rejects.toMatchObject({ reason: "not_ready" });
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
    expect(await client.plaidItem.count({ where: { plaidItemId: `${suffix}-new-item` } })).toBe(0);

    itemRemove.mockReset().mockRejectedValue(new Error("Plaid is down"));
    await expect(run(slow)).rejects.toMatchObject({ reason: "not_ready" });
    const kept = await client.plaidItem.findFirstOrThrow({
      where: { plaidItemId: `${suffix}-new-item` },
    });
    // Whatever its age, the nightly job takes a "replaced" row.
    expect(kept.status).toBe("replaced");
    expect(decrypt(kept.accessTokenEncrypted)).toBe(NEW_TOKEN);
    itemRemove.mockReset().mockResolvedValue({ data: {} });
    expect(await removeLeftoverReplaced({ client, api, userIds: [userId] })).toBe(1);
    expect(await client.plaidItem.count({ where: { plaidItemId: `${suffix}-new-item` } })).toBe(0);
    await oldIntact();
  });

  it("F1: a hidden row is not a bank link anywhere a person or a job looks", async () => {
    const hidden = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `${suffix}-hidden`,
        accessTokenEncrypted: encrypt("access-sandbox-hidden"),
        institutionName: "Slow Platypus Bank",
        status: "replacing",
      },
    });
    expect((await historyForPerson(userId, { client, now: NOW })).map((i) => i.itemId)).toEqual([
      oldItem,
    ]);
    expect(
      (await loadBankNotices(userId, { client, now: NOW })).map((n) => n.itemId),
    ).not.toContain(hidden.id);
    const hook0 = { item_id: `${suffix}-hidden`, webhook_type: "ITEM", webhook_code: "ERROR" };
    expect(await planWebhook(hook0 as never, { client, now: NOW })).toBeNull();
    expect(
      await planWebhook({ ...hook0, webhook_code: "LOGIN_REPAIRED" } as never, {
        client,
        now: NOW,
      }),
    ).toBeNull();
    await expect(syncItem(hidden.id, { client, api, now: NOW })).rejects.toThrow(/replaced/);
    await expect(markItemRepaired(userId, hidden.id, { client })).rejects.toBeInstanceOf(
      ItemNotFoundError,
    );
    expect((await client.plaidItem.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe(
      "replacing",
    );
    // The next tap's offer still looks only at the real link.
    expect(
      await client.plaidItem.count({
        where: { userId, status: { notIn: ["replaced", "replacing"] } },
      }),
    ).toBe(1);
  });

  // F2 (major): a sync and the move exclude each other, for real, on two connections.
  it.each([
    ["adds one row", false],
    ["adds one row and removes another (the count does not change)", true],
  ])(
    "F2: a sync that is writing holds the move off; when it commits and %s, the move refuses",
    async (_name, alsoRemove) => {
      const other = newClient();
      let releaseAll: (() => void) | undefined;
      try {
        let locked!: () => void;
        const gotLock = new Promise<void>((r) => (locked = r));
        let release!: () => void;
        const hold = new Promise<void>((r) => (release = r));
        releaseAll = release;
        // The sync's write transaction: it takes the link's row lock (shared) first, as saveTransactions does.
        const syncWrites = other.$transaction(
          async (t) => {
            await t.$queryRaw`SELECT id FROM plaid_items WHERE id = ${oldItem} AND status = 'active' FOR SHARE`;
            locked();
            await hold;
            await t.transaction.create({
              data: {
                userId,
                accountId: oldAccount,
                source: "plaid",
                plaidTransactionId: `${suffix}-late-add`,
                date: new Date("2026-11-09"),
                amountCents: 700,
                description: "LATE",
              },
            });
            if (alsoRemove)
              await t.transaction.deleteMany({ where: { plaidTransactionId: `${suffix}-old-r2` } });
          },
          { timeout: 60_000 },
        );
        await gotLock;
        const move = run().then(
          () => "moved",
          (error: { reason?: string }) => error.reason ?? String(error),
        );
        await wait(1500);
        // The move is waiting on the sync: the old link is still active, nothing has moved.
        expect((await client.plaidItem.findUniqueOrThrow({ where: { id: oldItem } })).status).toBe(
          "active",
        );
        release();
        await syncWrites;
        expect(await move).toBe("busy");
        await oldIntact();
        const late = await client.transaction.count({
          where: { plaidTransactionId: `${suffix}-late-add` },
        });
        expect(late).toBe(1);
        // The new Item was taken off Plaid.
        expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
      } finally {
        releaseAll?.();
        await other.$disconnect();
      }
    },
  );

  it("F2: a sync's writes wait for another connection that holds the link's row", async () => {
    const other = newClient();
    let releaseAll: (() => void) | undefined;
    try {
      let locked!: () => void;
      const gotLock = new Promise<void>((r) => (locked = r));
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      releaseAll = release;
      const holder = other.$transaction(
        async (t) => {
          await t.$queryRaw`SELECT id FROM plaid_items WHERE id = ${oldItem} FOR UPDATE`;
          locked();
          await hold;
        },
        { timeout: 60_000 },
      );
      await gotLock;
      transactionsSync.mockReset().mockResolvedValue(
        syncPage({
          accounts: [plaidAccount({ account_id: acc })],
          added: [tx(`${suffix}-sync-late`, "2026-11-10", {}, acc)] as never,
          next_cursor: "old-cursor-2",
        }),
      );
      let done = false;
      const sync = syncItem(oldItem, { client, api, now: NOW })
        .catch(() => undefined)
        .finally(() => (done = true));
      await wait(1500);
      expect(done).toBe(false);
      expect(
        await client.transaction.count({ where: { plaidTransactionId: `${suffix}-sync-late` } }),
      ).toBe(0);
      release();
      await holder;
      await sync;
      expect(
        await client.transaction.count({ where: { plaidTransactionId: `${suffix}-sync-late` } }),
      ).toBe(1);
    } finally {
      releaseAll?.();
      await other.$disconnect();
    }
  });

  // F3 (major): a charge the new Item words differently is not counted twice.
  it("F3: two identical coffees on one day pair one for one", async () => {
    await oldRow("c1", "2026-11-12", 450, { description: "COFFEE" });
    await oldRow("c2", "2026-11-12", 450, { description: "COFFEE" });
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded([
            tx(`${suffix}-new-c1`, "2026-11-12", { name: "COFFEE", amount: 4.5 }),
            tx(`${suffix}-new-c2`, "2026-11-12", { name: "COFFEE", amount: 4.5 }),
          ]),
        ),
      );
    const result = await run();
    expect(result).toMatchObject({ dropped: 0 });
    const coffees = await rowsOn("2026-11-12", 450);
    expect(coffees.map((c) => c.plaidTransactionId).sort()).toEqual([
      `${suffix}-new-c1`,
      `${suffix}-new-c2`,
    ]);
  });

  it("F3: a posted date that moved by two days is the same charge", async () => {
    const mine = await oldRow("moved", "2026-11-12", 450, {
      description: "COFFEE X",
      categorySource: "user",
      pfcPrimary: "FOOD_AND_DRINK",
    });
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded([tx(`${suffix}-new-moved`, "2026-11-14", { name: "COFFEE X", amount: 4.5 })]),
        ),
      );
    await run();
    expect(await rowsOn("2026-11-12", 450)).toHaveLength(0);
    const rows = await rowsOn("2026-11-14", 450);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: mine.id,
      plaidTransactionId: `${suffix}-new-moved`,
      categorySource: "user",
    });
  });

  it("F3: every row with something of the person's on it keeps its own row id and its records and only takes the new Plaid id; a statement row is untouched", async () => {
    const hang = async (key: string, date: string, cents: number, over: object = {}) => {
      const row = await oldRow(key, date, cents, over);
      return row;
    };
    const handSet = await hang("hand", "2026-10-22", 111, {
      categorySource: "user",
      pfcPrimary: "ENTERTAINMENT",
    });
    const notIncome = await hang("notinc", "2026-10-23", -90000, { incomePlacement: "declined" });
    const tagged = await hang("tagged", "2026-10-24", 113);
    await client.taxTag.create({ data: { userId, transactionId: tagged.id, tag: "business" } });
    const receipt = await hang("hsa", "2026-10-25", 114);
    await client.hsaReceipt.create({
      data: {
        userId,
        transactionId: receipt.id,
        amountCents: 114,
        date: new Date("2026-10-25"),
        merchant: "Pharmacy",
      },
    });
    const sudden = await hang("sudden", "2026-10-26", -500000);
    await client.suddenMoney.create({
      data: {
        userId,
        transactionId: sudden.id,
        amountCents: 500000,
        depositedOn: new Date("2026-10-26"),
      },
    });
    const goal = await hang("goal", "2026-10-27", 116);
    await client.goalTransfer.create({
      data: { userId, transactionId: goal.id, amountCents: 116, status: "counted" },
    });
    const shared = await hang("shared", "2026-10-28", 117);
    const household = await client.household.create({ data: {} });
    households.push(household.id);
    await client.sharedCharge.create({
      data: {
        householdId: household.id,
        transactionId: shared.id,
        payerId: userId,
        amountCents: 117,
        partnerShareBps: 5000,
        userId,
      },
    });
    const statement = await client.transaction.create({
      data: {
        userId,
        accountId: oldAccount,
        source: "csv",
        date: new Date("2026-10-31"),
        amountCents: 119,
        description: "FROM A STATEMENT",
      },
    });

    // The new read has each of them under its own id and the same words.
    const mirror = (key: string, day: string, dollars: number) =>
      tx(`${suffix}-new-${key}`, day, { name: `OLD ${key}`, amount: dollars });
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded([
            mirror("hand", "2026-10-22", 1.11),
            mirror("notinc", "2026-10-23", -900),
            mirror("tagged", "2026-10-24", 1.13),
            mirror("hsa", "2026-10-25", 1.14),
            mirror("sudden", "2026-10-26", -5000),
            mirror("goal", "2026-10-27", 1.16),
            mirror("shared", "2026-10-28", 1.17),
          ]),
        ),
      );
    const result = await run();
    expect(result.dropped).toBe(0);
    for (const key of ["hand", "notinc", "tagged", "hsa", "sudden", "goal", "shared"]) {
      const row = await client.transaction.findFirstOrThrow({
        where: { plaidTransactionId: `${suffix}-new-${key}` },
      });
      expect(row.description).toBe(`OLD ${key}`);
    }
    const ids = async (ids: string[]) =>
      (await client.transaction.findMany({ where: { id: { in: ids } } })).map((r) => r.id).sort();
    const keptIds = [handSet, notIncome, tagged, receipt, sudden, goal, shared, statement].map(
      (r) => r.id,
    );
    expect(await ids(keptIds)).toEqual([...keptIds].sort());
    // What hangs on them is where it was.
    expect(await client.taxTag.count({ where: { userId } })).toBe(1);
    expect(await client.hsaReceipt.count({ where: { userId } })).toBe(1);
    expect(await client.suddenMoney.count({ where: { userId } })).toBe(1);
    expect(await client.goalTransfer.count({ where: { userId } })).toBe(1);
    expect(await client.sharedCharge.count({ where: { transactionId: shared.id } })).toBe(1);
    expect(await client.transaction.count({ where: { userId, incomePlacement: "declined" } })).toBe(
      1,
    );
    expect(await client.transaction.findUniqueOrThrow({ where: { id: handSet.id } })).toMatchObject(
      {
        categorySource: "user",
        pfcPrimary: "ENTERTAINMENT",
        plaidTransactionId: `${suffix}-new-hand`,
      },
    );
    expect(
      await client.transaction.findUniqueOrThrow({ where: { id: statement.id } }),
    ).toMatchObject({
      source: "csv",
      plaidTransactionId: null,
      description: "FROM A STATEMENT",
    });
  });

  it("F3: a touched row whose charge the new read words differently is kept and its counterpart is not added beside it", async () => {
    const mine = await oldRow("mine", "2026-11-12", 450, {
      description: "OLD WORDS",
      categorySource: "user",
      pfcPrimary: "FOOD_AND_DRINK",
    });
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded([tx(`${suffix}-new-mine`, "2026-11-13", { name: "NEW WORDS", amount: 4.5 })]),
        ),
      );
    await run();
    const rows = await client.transaction.findMany({
      where: { userId, amountCents: 450 },
    });
    expect(rows.map((r) => r.id)).toEqual([mine.id]);
    expect(rows[0]).toMatchObject({
      categorySource: "user",
      plaidTransactionId: `${suffix}-new-mine`,
    });
  });

  it("F3: when the new read would remove far more than a few charges, nothing is deleted and the move refuses", async () => {
    for (let i = 0; i < 30; i += 1) await oldRow(`bulk${i}`, "2026-10-25", 5000 + i);
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    await oldIntact();
    expect(
      await client.transaction.count({
        where: { userId, description: { startsWith: "OLD bulk" } },
      }),
    ).toBe(30);
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
  });

  // F4 (major): a pending row is not deleted while anything hangs on it, or while it is young.
  it("F4: an old pending row with nothing on it goes; a young one, or one with a receipt, a sudden-money record, a goal transfer or a shared charge, stays", async () => {
    const old0 = await oldRow("p-old", "2026-11-01", 555, { pending: true });
    const young = await oldRow("p-young", "2026-11-25", 556, { pending: true });
    const receipt = await oldRow("p-hsa", "2026-11-01", 557, { pending: true });
    await client.hsaReceipt.create({
      data: {
        userId,
        transactionId: receipt.id,
        amountCents: 557,
        date: new Date("2026-11-01"),
        merchant: "Pharmacy",
      },
    });
    const sudden = await oldRow("p-sudden", "2026-11-01", -558, { pending: true });
    await client.suddenMoney.create({
      data: {
        userId,
        transactionId: sudden.id,
        amountCents: 558,
        depositedOn: new Date("2026-11-01"),
      },
    });
    const goal = await oldRow("p-goal", "2026-11-01", 559, { pending: true });
    await client.goalTransfer.create({
      data: { userId, transactionId: goal.id, amountCents: 559, status: "counted" },
    });
    const shared = await oldRow("p-shared", "2026-11-01", 560, { pending: true });
    const household = await client.household.create({ data: {} });
    households.push(household.id);
    await client.sharedCharge.create({
      data: {
        householdId: household.id,
        transactionId: shared.id,
        payerId: userId,
        amountCents: 560,
        partnerShareBps: 5000,
        userId,
      },
    });
    await run();
    expect(await client.transaction.count({ where: { id: old0.id } })).toBe(0);
    for (const row of [young, receipt, sudden, goal, shared]) {
      const kept = await client.transaction.findUniqueOrThrow({ where: { id: row.id } });
      // Kept under a legacy id, so no id of the new link can collide with it.
      expect(kept.plaidTransactionId).toBe(`legacy-pending:${row.plaidTransactionId}`);
    }
    expect(await client.hsaReceipt.count({ where: { userId } })).toBe(1);
    expect(await client.suddenMoney.count({ where: { userId } })).toBe(1);
    expect(await client.goalTransfer.count({ where: { userId } })).toBe(1);
    expect(await client.sharedCharge.count({ where: { transactionId: shared.id } })).toBe(1);
  });

  it("F4: a kept pending charge is taken over by its posted charge from the new link, and the person's category goes with it", async () => {
    const ghost = await oldRow("p-dinner", "2026-11-25", 4800, {
      pending: true,
      description: "DINNER AT JOES",
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_RESTAURANT",
      categorySource: "user",
    });
    const result = await run();
    expect(
      (await client.transaction.findUniqueOrThrow({ where: { id: ghost.id } })).plaidTransactionId,
    ).toBe(`legacy-pending:${suffix}-p-dinner`);
    // The new link's next sync: the charge posted two days later, a tip higher, naming a pending id the
    // database never had (ids are the new link's own).
    transactionsSync.mockReset().mockResolvedValue(
      syncPage({
        accounts: [plaidAccount({ account_id: newAcc })],
        added: [
          tx(`${suffix}-new-dinner`, "2026-11-26", {
            name: "DINNER AT JOES",
            amount: 55,
            pending_transaction_id: `${suffix}-new-pending-id`,
          }),
        ] as never,
        next_cursor: "new-cursor-2",
      }),
    );
    await syncItem(result.itemId, { client, api, now: NOW });
    const rows = await client.transaction.findMany({
      where: { userId, description: "DINNER AT JOES" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: ghost.id,
      plaidTransactionId: `${suffix}-new-dinner`,
      pending: false,
      amountCents: 5500,
      categorySource: "user",
      pfcPrimary: "FOOD_AND_DRINK",
    });
  });

  // The founder's rule: net worth always matches Plaid and never moves because of this flow.
  it("net worth is equal before and after to the cent, and so are the worked-back past balances for the days both reads cover", async () => {
    const worth = async () =>
      (await client.account.findMany({ where: { userId } })).reduce(
        (n, a) => n + (a.currentBalanceCents ?? 0),
        0,
      );
    const past = async () =>
      new Map(
        (
          await client.balanceSnapshot.findMany({ where: { userId, source: PAST_BALANCE_SOURCE } })
        ).map((b) => [`${b.accountId}|${b.date.toISOString().slice(0, 10)}`, b.balanceCents]),
      );
    await rebuildPastBalances(userId, { client, now: NOW });
    const before = await past();
    const netBefore = await worth();
    expect(before.size).toBeGreaterThan(5);
    // The new read reaches further back: a charge only it has, older than anything Jane held.
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(fullAdded([tx(`${suffix}-new-older`, "2026-09-20", { amount: 30 })])),
      );
    await run();
    expect(await worth()).toBe(netBefore);
    await rebuildPastBalances(userId, { client, now: NOW });
    const after = await past();
    for (const [key, cents] of before) expect(after.get(key)).toBe(cents);
    expect(after.size).toBeGreaterThan(before.size);
  });

  // ---------------------------------------------------------------------------------------------
  // Second review: a posted charge is never deleted; the plain-id references; the refusal's record; the
  // mutations the first round of tests did not catch; the cost of an ordinary sync.
  // ---------------------------------------------------------------------------------------------
  it("a posted charge with no twin inside the new read's days refuses the move, writes nothing and tells the team", async () => {
    await oldRow("lonely", "2026-10-25", 999, { description: "ONLY AT THE OLD LINK" });
    const before = await client.transaction.count({ where: { userId } });
    const eventsBefore = await client.opsEvent.count({ where: { kind: "plaid_history_refused" } });
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    expect(await client.transaction.count({ where: { userId } })).toBe(before);
    await oldIntact();
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([NEW_TOKEN]);
    // The record: a reason code and counts, nothing else.
    const audit = await client.auditLog.findFirstOrThrow({
      where: { event: "plaid_history_refused", targetId: oldItem },
    });
    expect(audit.metadata).toMatchObject({ reason: "read_differs", holes: 1 });
    expect(JSON.stringify(audit.metadata)).not.toContain("access-");
    // This attempt added one.
    expect(await client.opsEvent.count({ where: { kind: "plaid_history_refused" } })).toBe(
      eventsBefore + 1,
    );
  });

  it("a charge the new read words differently, within the slack, is one charge: the move goes and counts it once", async () => {
    await oldRow("reworded", "2026-11-15", 999, { description: "AMZN MKTP US" });
    transactionsSync.mockReset().mockResolvedValue(
      full(
        fullAdded([
          tx(`${suffix}-new-reworded`, "2026-11-16", {
            name: "AMAZON MARKETPLACE",
            amount: 9.99,
          }),
        ]),
      ),
    );
    await run();
    expect(await rowsOn("2026-11-16", 999)).toHaveLength(1);
    expect(await client.transaction.count({ where: { userId, amountCents: 999 } })).toBe(1);
  });

  it("S1b: a stale pending row that a saving, a closed month, an alert or a tax profile names by id is kept", async () => {
    const make = async (key: string) =>
      oldRow(key, "2026-11-01", 700 + key.length, { pending: true });
    const bare = await make("n-bare");
    const evidence = await make("n-outcome");
    const held = await make("n-held");
    const month = await make("n-month");
    const alert = await make("n-alert");
    const giving = await make("n-giving");
    await client.suggestionOutcome.create({
      data: {
        userId,
        suggestionKey: `s1b-${suffix}`,
        capability: "subscriptions",
        topic: "subscriptions",
        title: "x",
        firstShownAt: NOW,
        lastShownAt: NOW,
        expectedCents: 100,
        worthKind: "saving",
        confidencePercent: 90,
        status: "confirmed",
        confirmedCents: 100,
        evidenceTxIds: [evidence.id],
        heldEvidenceTxIds: [held.id],
      },
    });
    await client.monthClose.create({
      data: { userId, month: "2026-10", status: "waiting", uncertain: [month.id], figures: {} },
    });
    await client.alert.create({
      data: {
        userId,
        type: "unusual_activity",
        key: `large:SOME MERCHANT:${alert.id}`,
        title: "x",
        body: "x",
      },
    });
    await client.taxProfile.upsert({
      where: { userId },
      create: { userId, givingReceipts: [giving.id] },
      update: { givingReceipts: [giving.id] },
    });
    await run();
    expect(await client.transaction.count({ where: { id: bare.id } })).toBe(0);
    for (const row of [evidence, held, month, alert, giving]) {
      const kept = await client.transaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(kept.plaidTransactionId).toBe(`legacy-pending:${row.plaidTransactionId}`);
    }
  });

  // Mutation: the protection read again at the delete. A tag written after the plan was made, before the
  // move's transaction, keeps the row (and the row goes under its legacy id).
  it("a stale pending row tagged after the plan was made is kept by the check at the delete", async () => {
    const pending = await oldRow("late-tag", "2026-11-01", 555, { pending: true });
    hook.once = async () => {
      await client.taxTag.create({ data: { userId, transactionId: pending.id, tag: "business" } });
    };
    await run();
    const kept = await client.transaction.findUniqueOrThrow({ where: { id: pending.id } });
    expect(kept.plaidTransactionId).toBe(`legacy-pending:${suffix}-late-tag`);
    expect(await client.taxTag.count({ where: { userId } })).toBe(1);
  });

  // Mutation: the status guard inside lockLiveItem. Plaid will not remove the old Item, so its row stays
  // "replaced" (it is not deleted right after the move); a sync that was already past its early check must
  // still write nothing.
  it("a sync that was past its check writes nothing even when the replaced row is still there", async () => {
    const coffeeOld = tx(`${suffix}-old-coffee2`, "2026-11-12", { name: "COFFEE TWO" }, acc);
    const coffeeNew = tx(`${suffix}-new-coffee2`, "2026-11-12", { name: "COFFEE TWO" });
    transactionsSync.mockReset().mockImplementation(async ({ access_token }) =>
      access_token === OLD_TOKEN
        ? syncPage({
            accounts: [plaidAccount({ account_id: acc })],
            added: [coffeeOld] as never,
            next_cursor: "old-cursor-2",
          })
        : full(fullAdded([coffeeNew])),
    );
    itemRemove.mockReset().mockImplementation(async ({ access_token }) => {
      if (access_token === OLD_TOKEN) throw new Error("Plaid is down");
      return { data: {} };
    });
    hook.once = async () => {
      await run();
    };
    await syncItem(oldItem, { client, api, now: NOW }).catch(() => undefined);
    const old = await client.plaidItem.findUniqueOrThrow({ where: { id: oldItem } });
    expect(old.status).toBe("replaced");
    const coffees = await client.transaction.findMany({
      where: { userId, description: "COFFEE TWO" },
    });
    expect(coffees.map((c) => c.plaidTransactionId)).toEqual([`${suffix}-new-coffee2`]);
  });

  // Mutation: FOR SHARE. A real sync (not a stand-in) is made slow inside its write transaction by a row lock
  // another connection holds on a transaction row it updates; the move must wait for it.
  it("a real sync that is writing holds the move off", async () => {
    const other = newClient();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const gotLock = new Promise<void>((r) => (locked = r));
    try {
      const rowLock = other.$transaction(
        async (t) => {
          await t.$queryRaw`SELECT id FROM transactions WHERE plaid_transaction_id = ${`${suffix}-old-r0`} FOR UPDATE`;
          locked();
          await hold;
        },
        { timeout: 60_000 },
      );
      await gotLock;
      transactionsSync.mockReset().mockResolvedValue(
        syncPage({
          accounts: [plaidAccount({ account_id: acc })],
          added: [tx(`${suffix}-old-r0`, "2026-10-19", { amount: 20.5 }, acc)] as never,
          next_cursor: "old-cursor-2",
        }),
      );
      const sync = syncItem(oldItem, { client, api, now: NOW }).catch(() => undefined);
      await wait(1500);
      transactionsSync.mockReset().mockResolvedValue(full(fullAdded()));
      const move = run().then(
        () => "moved",
        (error: { reason?: string }) => error.reason ?? String(error),
      );
      await wait(1500);
      // The sync holds the link's row (shared) while it waits for the transaction row: the move's claim
      // waits behind it, so the old link is still active.
      expect((await client.plaidItem.findUniqueOrThrow({ where: { id: oldItem } })).status).toBe(
        "active",
      );
      release();
      await rowLock;
      await sync;
      // The sync changed a row the move had read: it refuses, or goes after the sync, and never both.
      expect(["busy", "moved"]).toContain(await move);
    } finally {
      release();
      await other.$disconnect();
    }
  });

  // The words of a row a sync changed between the read and the claim make the match stale.
  it("a row a sync gave other words between the read and the claim refuses the move", async () => {
    const other = newClient();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const gotLock = new Promise<void>((r) => (locked = r));
    try {
      const sync = other.$transaction(
        async (t) => {
          await t.$queryRaw`SELECT id FROM plaid_items WHERE id = ${oldItem} AND status = 'active' FOR SHARE`;
          locked();
          await hold;
          await t.transaction.updateMany({
            where: { plaidTransactionId: `${suffix}-old-r1` },
            data: { description: "SHOP RENAMED" },
          });
        },
        { timeout: 60_000 },
      );
      await gotLock;
      const move = run().then(
        () => "moved",
        (error: { reason?: string }) => error.reason ?? String(error),
      );
      await wait(1000);
      release();
      await sync;
      expect(await move).toBe("busy");
      await oldIntact();
    } finally {
      release();
      await other.$disconnect();
    }
  });

  // A hidden link Plaid will not remove, night after night, is told to the team.
  it("a hidden link whose removal fails three nights raises an ops event once", async () => {
    const hidden = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `${suffix}-stuck`,
        accessTokenEncrypted: encrypt("access-sandbox-stuck"),
        institutionName: "Slow Platypus Bank",
        status: "replaced",
      },
    });
    itemRemove.mockReset().mockRejectedValue(new Error("Plaid is down"));
    const events = () => client.opsEvent.count({ where: { kind: "plaid_removal_stuck" } });
    const before = await events();
    for (let night = 1; night <= 2; night += 1) {
      await removeLeftoverReplaced({ client, api, userIds: [userId] });
      expect(await events()).toBe(before);
    }
    await removeLeftoverReplaced({ client, api, userIds: [userId] });
    expect(await events()).toBe(before + 1);
    expect(
      (await client.plaidItem.findUniqueOrThrow({ where: { id: hidden.id } })).lastErrorCode,
    ).toBe("REMOVAL_STUCK_3");
    await removeLeftoverReplaced({ client, api, userIds: [userId] });
    expect(await events()).toBe(before + 1);
  });

  // The 240 s cap bounds the categories too: past what is left of it the rows are saved without a category
  // and the move still goes.
  it("a categorize that never answers does not hold the move: rows are saved uncategorized", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    // Most of the 240 s is spent by the time the categories are asked for: one second of it is left.
    accountsGet.mockReset().mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 209_000);
      return { data: { accounts: [plaidAccount({ account_id: newAcc })] } };
    });
    hook.once = () => new Promise<void>(() => {});
    transactionsSync
      .mockReset()
      .mockResolvedValue(
        full(
          fullAdded([tx(`${suffix}-new-extra`, "2026-11-09", { name: "BRAND NEW", amount: 7 })]),
        ),
      );
    const result = await run();
    expect(result.added).toBe(1);
    const row = await client.transaction.findFirstOrThrow({
      where: { plaidTransactionId: `${suffix}-new-extra` },
    });
    expect(row).toMatchObject({ categorySource: null, pfcDetailed: null });
  });

  // The cost of an ordinary sync: the number of statements the database sees for the writes of one sync.
  it("an ordinary sync writes its accounts and rows in few statements", async () => {
    const counted: string[] = [];
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      log: [{ emit: "event", level: "query" }],
    });
    (counting as unknown as { $on: (e: string, f: (q: { query: string }) => void) => void }).$on(
      "query",
      (q) => counted.push(q.query),
    );
    try {
      transactionsSync.mockReset().mockResolvedValue(
        syncPage({
          accounts: [plaidAccount({ account_id: acc })],
          added: [
            tx(`${suffix}-ord-1`, "2026-11-10", {}, acc),
            tx(`${suffix}-ord-2`, "2026-11-11", {}, acc),
          ] as never,
          next_cursor: "old-cursor-2",
        }),
      );
      await syncItem(oldItem, { client: counting, api, now: NOW });
      const locks = counted.filter((q) => /FOR SHARE/i.test(q)).length;
      // One lock per write transaction: the accounts, the rows. Never one per row or per account.
      expect(locks).toBe(2);
    } finally {
      await counting.$disconnect();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Third review: the last day of the read, the wait after a refusal, a lost commit answer, another
  // person's account.
  // ---------------------------------------------------------------------------------------------
  // T1: a posted row after the new read's last day is neither refused on nor touched.
  it("T1: a posted row newer than the new read's last day is kept as it is, and the move goes through", async () => {
    const late = await oldRow("late", "2026-11-20", 777, { description: "LATE CHARGE" });
    const result = await run();
    expect(result.dropped).toBe(0);
    expect(await client.transaction.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({
      plaidTransactionId: `${suffix}-late`,
      amountCents: 777,
    });
  });

  // T3 (and T2): after a refusal the tap is not offered again for REFUSAL_WAIT_DAYS, in the page's offer
  // and in the server's own check, so a retap makes no second billed Item; the page says why.
  it("T3: after a refusal the tap is not offered again for a week, the server refuses a retap, and the page says why", async () => {
    const hole = await oldRow("hole", "2026-10-25", 4242);
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    const lines = await historyForPerson(userId, { client, now: NOW });
    expect(lines.some((l) => l.offer)).toBe(false);
    const notices = await loadBankNotices(userId, { client, now: NOW });
    const waiting = notices.find((n) => n.kind === "full_history_waiting");
    expect(waiting?.title).toContain("could not get the full history");
    expect(waiting?.words).toContain("nothing was changed");
    expect(notices.some((n) => n.kind === "full_history")).toBe(false);
    // A retap, even with the hole gone: no new Item is made.
    await client.transaction.delete({ where: { id: hole.id } });
    exchange.mockClear();
    await expect(run()).rejects.toMatchObject({ reason: "not_offered" });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("T2: a week after a refusal the next tap works once the hole is gone", async () => {
    const hole = await oldRow("hole2", "2026-10-25", 4243);
    await expect(run()).rejects.toMatchObject({ reason: "read_differs" });
    await oldIntact();
    await client.transaction.delete({ where: { id: hole.id } });
    const later = new Date(Date.now() + 8 * 86_400_000);
    exchange.mockResolvedValue({
      data: { access_token: NEW_TOKEN, item_id: `${suffix}-new-item` },
    });
    await expect(
      replaceWithFullHistory(
        userId,
        oldItem,
        "public-sandbox-x",
        "Slow Platypus Bank",
        { client, api, sleep },
        later,
      ),
    ).resolves.toMatchObject({ dropped: 0 });
  });

  // C: the answer to the move's commit is lost after the database committed.
  it("a commit that succeeds and then throws finishes as a success: the new link is kept and the old one removed", async () => {
    let armed = false;
    hook.once = async () => {
      armed = true;
    };
    const flaky = new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "$transaction" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (fn: unknown, options: unknown) => {
          const result = await value.call(target, fn, options);
          if (armed && typeof fn === "function") {
            armed = false;
            throw new Error("connection lost after the commit");
          }
          return result;
        };
      },
    }) as PrismaClient;
    const result = await replaceWithFullHistory(
      userId,
      oldItem,
      "public-sandbox-x",
      "Slow Platypus Bank",
      { client: flaky, api, sleep },
      NOW,
    );
    expect(result.twins).toBe(3);
    const items = await client.plaidItem.findMany({ where: { userId } });
    expect(items.map((i) => [i.plaidItemId, i.status])).toEqual([[`${suffix}-new-item`, "active"]]);
    expect(await client.account.count({ where: { userId, itemId: items[0].id } })).toBe(1);
    // The old Item went at Plaid; the new one was never removed.
    expect(itemRemove.mock.calls.map((c) => c[0].access_token)).toEqual([OLD_TOKEN]);
  });

  // D: an account whose Plaid id is another person's is not skipped in silence.
  it("a sync whose link lists an account of another person fails, and writes nothing", async () => {
    const other = await client.user.create({ data: { email: `other-${suffix}@example.com` } });
    try {
      await client.account.create({
        data: {
          userId: other.id,
          source: "plaid",
          plaidAccountId: `${suffix}-foreign`,
          name: "Not mine",
          type: "depository",
          subtype: "checking",
          currentBalanceCents: 1,
        },
      });
      transactionsSync.mockReset().mockResolvedValue(
        syncPage({
          accounts: [
            plaidAccount({ account_id: acc }),
            plaidAccount({ account_id: `${suffix}-foreign`, mask: "9999" }),
          ],
          added: [tx(`${suffix}-foreign-tx`, "2026-11-10", {}, acc)] as never,
          next_cursor: "old-cursor-2",
        }),
      );
      await expect(syncItem(oldItem, { client, api, now: NOW })).rejects.toThrow(/another person/);
      expect(
        await client.transaction.count({ where: { plaidTransactionId: `${suffix}-foreign-tx` } }),
      ).toBe(0);
      expect(
        await client.account.findFirstOrThrow({ where: { plaidAccountId: `${suffix}-foreign` } }),
      ).toMatchObject({ userId: other.id, name: "Not mine" });
    } finally {
      await client.user.deleteMany({ where: { id: other.id } });
    }
  });

  // A: main's removal after a read from the start also takes the link's lock first and refuses a replaced link.
  it("the removal after a read from the start refuses on a replaced link and removes nothing", async () => {
    await client.plaidItem.update({ where: { id: oldItem }, data: { status: "replaced" } });
    const kept = await oldRow("kept-by-reread", "2026-10-25", 3131);
    const outcome = await finishRead(
      userId,
      new Map([[acc, oldAccount]]),
      {
        notReady: false,
        historyPending: false,
        transactions: [{ accountRef: acc, date: "2026-10-01", externalId: `${suffix}-listed` }],
      } as never,
      client,
      new Date(),
      oldItem,
    );
    // The lock refused: the cursor stays and nothing was removed.
    expect(outcome).toMatchObject({ removed: 0, keepCursor: true });
    expect(await client.transaction.count({ where: { id: kept.id } })).toBe(1);
  });
});
