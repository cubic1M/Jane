import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import {
  plaidAccount,
  plaidApiError,
  plaidStream,
  plaidTransaction,
  syncPage,
} from "@/data-sources/plaid/__fixtures__/plaid";
import { track } from "@/lib/analytics";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "./sync";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts),
// with Plaid's API mocked.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");

describe.runIf(url)("syncItem against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let itemId: string;
  const transactionsSync = vi.fn();
  const transactionsRecurringGet = vi.fn();
  const liabilitiesGet = vi.fn();
  const investmentsHoldingsGet = vi.fn();
  const investmentsTransactionsGet = vi.fn();
  const api = {
    transactionsSync,
    transactionsRecurringGet,
    liabilitiesGet,
    investmentsHoldingsGet,
    investmentsTransactionsGet,
  } as unknown as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `plaid-${suffix}@example.com` } })).id;
    itemId = (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${suffix}`,
          accessTokenEncrypted: encrypt("access-sandbox-test"),
          institutionName: "First Platypus Bank",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    transactionsSync.mockReset();
    transactionsRecurringGet.mockReset();
    liabilitiesGet.mockReset();
    investmentsHoldingsGet.mockReset();
    investmentsTransactionsGet.mockReset();
    vi.mocked(track).mockReset();
  });

  const netflix = (id: string, date: string, amount = 15.49) =>
    plaidTransaction({ transaction_id: `${suffix}-${id}`, date, amount });
  const transactions = () =>
    client.transaction.findMany({
      where: { userId },
      select: { plaidTransactionId: true, amountCents: true, categorySource: true },
      orderBy: { date: "asc" },
    });

  it("saves accounts, transactions and streams, then runs detection", async () => {
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: `${suffix}-acc` })],
        added: ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]
          .map((d, i) => netflix(`t${i}`, d))
          .map((t) => ({ ...t, account_id: `${suffix}-acc` })),
        next_cursor: "cursor-1",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce({
      data: {
        outflow_streams: [
          plaidStream({
            stream_id: `${suffix}-stream`,
            account_id: `${suffix}-acc`,
            transaction_ids: [0, 1, 2, 3].map((i) => `${suffix}-t${i}`),
          }),
        ],
        inflow_streams: [],
      },
    });

    const result = await syncItem(itemId, { client, api, now: NOW });

    expect(result).toEqual({
      accounts: 1,
      added: 4,
      updated: 0,
      removed: 0,
      firstSync: true,
      recurring: "updated",
      // Linked before Liabilities was asked for: never called, so never billed.
      liabilities: "off",
      investments: "off",
    });
    expect(liabilitiesGet).not.toHaveBeenCalled();
    expect(transactionsSync.mock.calls[0][0]).toMatchObject({
      access_token: "access-sandbox-test",
      cursor: undefined,
    });
    expect(await transactions()).toHaveLength(4);
    expect((await transactions())[0].categorySource).toBe("plaid");
    const item = await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item).toMatchObject({ transactionsCursor: "cursor-1", status: "active" });
    expect(await client.recurringStream.count({ where: { userId } })).toBe(1);
    const findings = await client.finding.findMany({ where: { userId }, select: { key: true } });
    expect(findings.map((f) => f.key)).toContain("merchant:netflix");
    expect(track).toHaveBeenCalledWith(userId, "first_sync_completed", expect.any(Object));
  });

  it("applies modifications and removals, and a rerun never duplicates", async () => {
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: `${suffix}-acc` })],
        added: [{ ...netflix("t3", "2026-10-01"), account_id: `${suffix}-acc` }],
        modified: [{ ...netflix("t2", "2026-09-01", 17.99), account_id: `${suffix}-acc` }],
        removed: [{ transaction_id: `${suffix}-t0`, account_id: `${suffix}-acc` }],
        next_cursor: "cursor-2",
      }),
    );
    transactionsRecurringGet.mockRejectedValueOnce(plaidApiError("PRODUCTS_NOT_SUPPORTED"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await syncItem(itemId, { client, api, now: NOW });

    expect(transactionsSync.mock.calls[0][0].cursor).toBe("cursor-1");
    expect(result).toMatchObject({ added: 0, updated: 2, removed: 1, firstSync: false });
    expect(result.recurring).toBe("unavailable");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("recurring"), {
      code: "PRODUCTS_NOT_SUPPORTED",
    });
    expect((await transactions()).map((t) => [t.plaidTransactionId, t.amountCents])).toEqual([
      [`${suffix}-t1`, 1549],
      [`${suffix}-t2`, 1799],
      [`${suffix}-t3`, 1549],
    ]);
    expect(track).not.toHaveBeenCalledWith(userId, "first_sync_completed", expect.anything());
  });

  it("keeps a category the person corrected when Plaid later changes the transaction", async () => {
    await client.transaction.updateMany({
      where: { plaidTransactionId: `${suffix}-t1` },
      data: {
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
        categorySource: "user",
      },
    });
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: `${suffix}-acc` })],
        modified: [{ ...netflix("t1", "2026-08-01", 16.49), account_id: `${suffix}-acc` }],
        next_cursor: "cursor-3",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce({
      data: { outflow_streams: [], inflow_streams: [] },
    });

    await syncItem(itemId, { client, api, now: NOW });

    const row = await client.transaction.findFirstOrThrow({
      where: { plaidTransactionId: `${suffix}-t1` },
    });
    expect(row).toMatchObject({
      amountCents: 1649,
      pfcDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
      categorySource: "user",
    });
  });

  it("replaces a pending transaction with its posted one, never counting both", async () => {
    const acc = `${suffix}-acc`;
    const noStreams = { data: { outflow_streams: [], inflow_streams: [] } };
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: acc })],
        added: [{ ...netflix("p1", "2026-10-10", 9.99), account_id: acc, pending: true }],
        next_cursor: "cursor-4",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce(noStreams);
    await syncItem(itemId, { client, api, now: NOW });
    // The person files the pending charge under a category of their own.
    await client.transaction.updateMany({
      where: { plaidTransactionId: `${suffix}-p1` },
      data: { pfcPrimary: "ENTERTAINMENT", categorySource: "user" },
    });

    // It posts: Plaid adds the posted one, pointing at the pending one, before (or without)
    // listing the pending one as removed.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: acc })],
        added: [
          {
            ...netflix("posted1", "2026-10-11", 9.99),
            account_id: acc,
            pending: false,
            pending_transaction_id: `${suffix}-p1`,
          },
        ],
        next_cursor: "cursor-5",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce(noStreams);
    await syncItem(itemId, { client, api, now: NOW });
    const ids = (await transactions()).map((t) => t.plaidTransactionId);
    expect(ids).toContain(`${suffix}-posted1`);
    expect(ids).not.toContain(`${suffix}-p1`);
    expect(
      await client.transaction.findFirstOrThrow({
        where: { plaidTransactionId: `${suffix}-posted1` },
      }),
    ).toMatchObject({ pending: false, pfcPrimary: "ENTERTAINMENT", categorySource: "user" });

    // Plaid's later removal of the pending one changes nothing.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: acc })],
        removed: [{ transaction_id: `${suffix}-p1`, account_id: acc }],
        next_cursor: "cursor-6",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce(noStreams);
    await syncItem(itemId, { client, api, now: NOW });
    expect((await transactions()).filter((t) => t.amountCents === 999)).toHaveLength(1);
  });

  it("keeps its cursor through a failure, says why, and the next sync resumes from it", async () => {
    transactionsSync.mockRejectedValueOnce(plaidApiError("INVALID_FIELD", 400));
    await expect(syncItem(itemId, { client, api, now: NOW })).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    const failed = await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(failed).toMatchObject({
      transactionsCursor: "cursor-6",
      status: "active",
      lastErrorCode: "INVALID_FIELD",
    });
    expect(failed.lastErrorAt).toEqual(NOW);

    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: `${suffix}-acc` })],
        next_cursor: "cursor-7",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    await syncItem(itemId, { client, api, now: NOW });
    expect(transactionsSync.mock.calls.at(-1)![0].cursor).toBe("cursor-6");
    expect(await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      transactionsCursor: "cursor-7",
      lastErrorCode: null,
      lastErrorAt: null,
    });
  });

  it("marks the bank for signing in again when Plaid says so, and a good sync clears it", async () => {
    transactionsSync.mockRejectedValueOnce(plaidApiError("ITEM_LOGIN_REQUIRED", 400));
    await expect(syncItem(itemId, { client, api, now: NOW })).rejects.toMatchObject({
      code: "ITEM_LOGIN_REQUIRED",
    });
    expect(await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
      status: "login_required",
      transactionsCursor: "cursor-7",
    });

    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [plaidAccount({ account_id: `${suffix}-acc` })],
        next_cursor: "cursor-8",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    await syncItem(itemId, { client, api, now: NOW });
    expect((await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe(
      "active",
    );
  });

  it("reads loans and card rates for items linked with Liabilities", async () => {
    const loanItem = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-loans-${suffix}`,
        accessTokenEncrypted: encrypt("access-sandbox-loans"),
        institutionName: "First Platypus Bank",
        liabilities: true,
      },
    });
    const card = plaidAccount({
      account_id: `${suffix}-card`,
      type: "credit",
      subtype: "credit card",
      balances: { current: 410.5, available: null, limit: 2000, iso_currency_code: "USD" },
    } as never);
    const mortgage = plaidAccount({
      account_id: `${suffix}-mortgage`,
      name: "Home loan",
      type: "loan",
      subtype: "mortgage",
      balances: { current: 56302.06, available: null, limit: null, iso_currency_code: "USD" },
    } as never);
    const liabilities = (withMortgage: boolean) => ({
      data: {
        accounts: withMortgage ? [card, mortgage] : [card],
        liabilities: {
          credit: [
            {
              account_id: `${suffix}-card`,
              aprs: [{ apr_percentage: 22.99, apr_type: "purchase_apr" }],
              is_overdue: false,
              minimum_payment_amount: 35,
              next_payment_due_date: "2026-11-05",
            },
          ],
          mortgage: withMortgage
            ? [
                {
                  account_id: `${suffix}-mortgage`,
                  account_number: "3120194154",
                  interest_rate: { percentage: 3.99, type: "fixed" },
                  next_monthly_payment: 3141.54,
                  next_payment_due_date: "2026-11-01",
                  maturity_date: "2045-07-31",
                  past_due_amount: 0,
                },
              ]
            : [],
          student: [],
        },
      },
    });
    // The transactions side doesn't list the mortgage; Liabilities still brings it in.
    transactionsSync.mockResolvedValue(syncPage({ accounts: [card], next_cursor: "loans-1" }));
    transactionsRecurringGet.mockResolvedValue({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    liabilitiesGet.mockResolvedValueOnce(liabilities(true));

    expect((await syncItem(loanItem.id, { client, api, now: NOW })).liabilities).toBe("updated");
    expect(liabilitiesGet).toHaveBeenCalledWith({ access_token: "access-sandbox-loans" });
    const accounts = await client.account.findMany({
      where: { itemId: loanItem.id },
      select: { name: true, type: true, subtype: true, currentBalanceCents: true },
      orderBy: { type: "asc" },
    });
    expect(accounts).toEqual([
      {
        name: "Plaid Checking",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 41050,
      },
      { name: "Home loan", type: "loan", subtype: "mortgage", currentBalanceCents: 5_630_206 },
    ]);
    const rows = await client.liability.findMany({
      where: { userId },
      select: { kind: true, aprBps: true, minimumPaymentCents: true, payoffDate: true },
      orderBy: { kind: "asc" },
    });
    expect(rows).toEqual([
      { kind: "credit", aprBps: 2299, minimumPaymentCents: 3500, payoffDate: null },
      {
        kind: "mortgage",
        aprBps: 399,
        minimumPaymentCents: 314_154,
        payoffDate: new Date("2045-07-31T00:00:00Z"),
      },
    ]);
    expect(JSON.stringify(await client.liability.findMany({ where: { userId } }))).not.toContain(
      "3120194154",
    );

    // The bank stops reporting the mortgage: its details go, the account stays.
    liabilitiesGet.mockResolvedValueOnce(liabilities(false));
    await syncItem(loanItem.id, { client, api, now: NOW });
    expect(await client.liability.count({ where: { userId } })).toBe(1);

    // Liabilities fails: the rest of the sync stands.
    liabilitiesGet.mockRejectedValueOnce(plaidApiError("PRODUCTS_NOT_SUPPORTED"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await syncItem(loanItem.id, { client, api, now: NOW })).liabilities).toBe(
      "unavailable",
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("liabilities"), {
      code: "PRODUCTS_NOT_SUPPORTED",
    });
    expect(await client.liability.count({ where: { userId } })).toBe(1);
    transactionsSync.mockReset();
    transactionsRecurringGet.mockReset();
  });

  it("keeps investment balances, holdings and investment transactions (spec step 128)", async () => {
    const investItem = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-invest-${suffix}`,
        accessTokenEncrypted: encrypt("access-sandbox-invest"),
        institutionName: "First Platypus Bank",
        investments: true,
      },
    });
    const k401 = plaidAccount({
      account_id: `${suffix}-401k`,
      name: "Plaid 401k",
      type: "investment",
      subtype: "401k",
      balances: { current: 23631.98, available: null, limit: null, iso_currency_code: "USD" },
    } as never);
    // A trade on the 401(k) comes through the transactions side too: it isn't kept.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [k401],
        added: [
          plaidTransaction({
            transaction_id: `${suffix}-trade`,
            account_id: `${suffix}-401k`,
            name: "BUY VTSAX",
          }),
        ],
        next_cursor: "invest-1",
      }),
    );
    transactionsRecurringGet.mockResolvedValueOnce({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    investmentsHoldingsGet.mockResolvedValueOnce({
      data: {
        accounts: [k401],
        holdings: [
          {
            account_id: `${suffix}-401k`,
            security_id: "sec1",
            quantity: 100,
            institution_value: 23631.98,
          },
        ],
        securities: [
          { security_id: "sec1", name: "Vanguard Total Stock Market", ticker_symbol: "VTSAX" },
        ],
      },
    });
    investmentsTransactionsGet.mockResolvedValueOnce({
      data: {
        accounts: [k401],
        securities: [],
        total_investment_transactions: 1,
        investment_transactions: [
          {
            investment_transaction_id: `${suffix}-inv-buy`,
            account_id: `${suffix}-401k`,
            security_id: "sec1",
            date: "2026-10-01",
            name: "BUY VTSAX",
            quantity: 3.5,
            amount: 500,
            price: 142.86,
            fees: 0,
            type: "buy",
            subtype: "buy",
            iso_currency_code: "USD",
          },
        ],
      },
    });

    const result = await syncItem(investItem.id, { client, api, now: NOW });
    expect(result.investments).toBe("updated");
    expect(investmentsHoldingsGet).toHaveBeenCalledWith({ access_token: "access-sandbox-invest" });
    expect(
      await client.account.findFirstOrThrow({
        where: { itemId: investItem.id },
        select: { type: true, subtype: true, currentBalanceCents: true },
      }),
    ).toEqual({ type: "investment", subtype: "401k", currentBalanceCents: 2_363_198 });
    // The trade isn't kept as spending: it's an investment transaction.
    expect(
      await client.transaction.count({ where: { plaidTransactionId: `${suffix}-trade` } }),
    ).toBe(0);
    expect(
      await client.holding.findFirstOrThrow({
        where: { account: { itemId: investItem.id } },
        select: { quantity: true, valueCents: true, security: { select: { ticker: true } } },
      }),
    ).toEqual({ quantity: 100, valueCents: 2_363_198, security: { ticker: "VTSAX" } });
    expect(
      await client.investmentTransaction.findFirstOrThrow({
        where: { plaidInvestmentTransactionId: `${suffix}-inv-buy` },
        select: { amountCents: true, type: true, subtype: true, securityId: true },
      }),
    ).toMatchObject({ amountCents: 50_000, type: "buy", subtype: "buy" });
    expect(investmentsTransactionsGet.mock.calls[0][0]).toMatchObject({
      start_date: "2024-10-15",
      end_date: "2026-10-15",
    });

    investmentsHoldingsGet.mockRejectedValueOnce(plaidApiError("PRODUCTS_NOT_SUPPORTED"));
    transactionsSync.mockResolvedValueOnce(syncPage({ accounts: [k401], next_cursor: "invest-2" }));
    transactionsRecurringGet.mockResolvedValueOnce({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await syncItem(investItem.id, { client, api, now: NOW })).investments).toBe(
      "unavailable",
    );
  });
});
