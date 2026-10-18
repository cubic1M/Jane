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
  const api = { transactionsSync, transactionsRecurringGet } as unknown as PlaidApi;

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
    });
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
});
