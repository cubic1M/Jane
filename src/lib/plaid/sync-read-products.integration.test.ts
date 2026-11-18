import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { plaidAccount, plaidApiError, syncPage } from "@/data-sources/plaid/__fixtures__/plaid";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "./sync";

// Liabilities and Investments are consented in Link but billed from Jane's first read of each
// (additional_consented_products, ./link.ts), so a link is read for one only when it has that kind
// of account: a checking-only link pays for neither (plaid.com/docs/link/initializing-products).
// Against a real, migrated Postgres, with Plaid's API mocked.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T12:00:00Z");

describe.runIf(url)("reading Liabilities and Investments only where they apply", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  const transactionsSync = vi.fn();
  const transactionsRecurringGet = vi.fn();
  const liabilitiesGet = vi.fn();
  const investmentsHoldingsGet = vi.fn();
  const investmentsTransactionsGet = vi.fn();
  const accountsGet = vi.fn();
  const api = {
    accountsGet,
    transactionsSync,
    transactionsRecurringGet,
    liabilitiesGet,
    investmentsHoldingsGet,
    investmentsTransactionsGet,
  } as unknown as PlaidApi;

  // A link made with both products consented, holding these accounts.
  async function linkWith(name: string, accounts: ReturnType<typeof plaidAccount>[]) {
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${name}-${suffix}`,
        accessTokenEncrypted: encrypt(`access-sandbox-${name}`),
        institutionName: "First Platypus Bank",
        liabilities: true,
        investments: true,
      },
    });
    transactionsSync.mockResolvedValueOnce(syncPage({ accounts, next_cursor: `${name}-1` }));
    return item.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `read-products-${suffix}@example.com` } }))
      .id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.stubEnv("PLAID_INVESTMENTS", "1");
    for (const fn of [
      accountsGet,
      transactionsSync,
      transactionsRecurringGet,
      liabilitiesGet,
      investmentsHoldingsGet,
      investmentsTransactionsGet,
    ]) {
      fn.mockReset();
    }
    transactionsRecurringGet.mockResolvedValue({
      data: { outflow_streams: [], inflow_streams: [] },
    });
    // Answered "not supported": still a read, which is what's counted here.
    liabilitiesGet.mockRejectedValue(plaidApiError("PRODUCTS_NOT_SUPPORTED"));
    investmentsHoldingsGet.mockRejectedValue(plaidApiError("PRODUCTS_NOT_SUPPORTED"));
  });

  it("reads neither for a checking-only link, so neither is billed", async () => {
    const id = await linkWith("checking", [
      plaidAccount({ account_id: `${suffix}-chk` }),
      plaidAccount({ account_id: `${suffix}-sav`, subtype: "savings" } as never),
    ]);
    const result = await syncItem(id, { client, api, now: NOW });
    expect(result).toMatchObject({ liabilities: "off", investments: "off" });
    expect(liabilitiesGet).not.toHaveBeenCalled();
    expect(investmentsHoldingsGet).not.toHaveBeenCalled();
  });

  it("reads Liabilities once for a link with a card, and no Investments", async () => {
    const id = await linkWith("card", [
      plaidAccount({ account_id: `${suffix}-chk2` }),
      plaidAccount({
        account_id: `${suffix}-card`,
        type: "credit",
        subtype: "credit card",
      } as never),
    ]);
    await syncItem(id, { client, api, now: NOW });
    expect(liabilitiesGet).toHaveBeenCalledTimes(1);
    expect(liabilitiesGet).toHaveBeenCalledWith({ access_token: "access-sandbox-card" });
    expect(investmentsHoldingsGet).not.toHaveBeenCalled();
  });

  it("reads Investments once for a link with a 401(k), and only while PLAID_INVESTMENTS is on", async () => {
    const id = await linkWith("retirement", [
      plaidAccount({ account_id: `${suffix}-401k`, type: "investment", subtype: "401k" } as never),
    ]);
    await syncItem(id, { client, api, now: NOW });
    expect(investmentsHoldingsGet).toHaveBeenCalledTimes(1);
    expect(liabilitiesGet).not.toHaveBeenCalled();

    vi.stubEnv("PLAID_INVESTMENTS", "");
    investmentsHoldingsGet.mockClear();
    transactionsSync.mockResolvedValueOnce(syncPage({ accounts: [], next_cursor: "retirement-2" }));
    await syncItem(id, { client, api, now: NOW });
    expect(investmentsHoldingsGet).not.toHaveBeenCalled();
  });
});
