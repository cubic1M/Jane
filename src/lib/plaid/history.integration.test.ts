import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { plaidAccount, plaidTransaction, syncPage } from "@/data-sources/plaid/__fixtures__/plaid";
import { encrypt } from "@/lib/crypto";
import { historyForPerson, historyForTeam, itemsStillCatchingUp, latestNotes } from "./history";
import { syncItem } from "./sync";

// Runs against a real, migrated Postgres (see sync.integration.test.ts), with Plaid's API mocked.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T12:00:00Z");
const LATER = new Date("2026-11-27T13:00:00Z");
const LINKED = new Date("2026-11-10T12:00:00Z");

describe.runIf(url)("a bank's history: what Jane holds, says, and goes back for", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  let userId: string;
  let itemId: string;
  const acc = `${suffix}-acc`;
  const transactionsSync = vi.fn();
  const api = {
    accountsGet: vi.fn(async () => ({ data: { accounts: [] } })),
    transactionsSync,
    transactionsRecurringGet: vi.fn(async () => ({
      data: { outflow_streams: [], inflow_streams: [] },
    })),
  } as unknown as PlaidApi;
  const account = () => plaidAccount({ account_id: acc });
  const tx = (id: string, date: string) => ({
    ...plaidTransaction({ transaction_id: `${suffix}-${id}`, date, amount: 12.34 }),
    account_id: acc,
  });
  const recent = ["2026-10-19", "2026-10-29", "2026-11-08"].map((d, i) => tx(`r${i}`, d));
  const older = Array.from({ length: 10 }, (_, i) =>
    tx(`o${i}`, `2025-${String(i + 1).padStart(2, "0")}-15`),
  );
  const held = () => client.transaction.count({ where: { account: { itemId } } });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: `history-${suffix}@example.com` } })).id;
    itemId = (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${suffix}`,
          accessTokenEncrypted: encrypt("access-sandbox-history"),
          institutionName: "Slow Platypus Bank",
          createdAt: LINKED,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { targetId: itemId } });
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    transactionsSync.mockReset();
  });

  it("notes what Plaid said and what is held, and says it in plain words", async () => {
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account()],
        added: recent,
        next_cursor: "c1",
        status: "INITIAL_UPDATE_COMPLETE",
      }),
    );
    await syncItem(itemId, { client, api, now: NOW });
    const note = (await latestNotes([itemId], { client })).get(itemId)!;
    expect(note).toMatchObject({
      status: "INITIAL_UPDATE_COMPLETE",
      earliest: "2026-10-19",
      latest: "2026-11-08",
      count: 3,
      daysRequested: 365,
      rescannedAt: null,
    });
    expect(note.cursorMovedAt).toBe(NOW.toISOString());

    const [h] = await historyForPerson(userId, { client, now: NOW });
    expect(h.line).toEqual({
      state: "pending",
      text: "History from Slow Platypus Bank: Oct 19, 2026 to today (Plaid is still sending older history).",
    });
    expect(h.offer).toBe(false);
    expect(await itemsStillCatchingUp({ client, now: NOW }, { equals: userId })).toEqual([itemId]);
    const team = (await historyForTeam({ client, now: NOW })).find((r) => r.itemId === itemId);
    expect(team).toMatchObject({ userId, held: { count: 3 } });
  });

  it("reads a short link again from an empty cursor once, and keeps what the person set", async () => {
    // The person put one charge in their own category.
    const edited = `${suffix}-r1`;
    await client.transaction.updateMany({
      where: { plaidTransactionId: edited },
      data: {
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_OTHER",
        categorySource: "user",
      },
    });
    // Plaid's full history, with Plaid's own category on the same charge.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account()],
        added: [
          ...recent.map((t) =>
            t.transaction_id === edited
              ? {
                  ...t,
                  personal_finance_category: {
                    primary: "FOOD_AND_DRINK",
                    detailed: "FOOD_AND_DRINK_RESTAURANT",
                    confidence_level: "HIGH",
                  },
                }
              : t,
          ),
          ...older,
        ],
        next_cursor: "c-fresh",
        status: "HISTORICAL_UPDATE_COMPLETE",
      }),
    );
    await syncItem(itemId, { client, api, now: LATER });
    // Asked from the start, not from the saved cursor "c1".
    expect(transactionsSync.mock.calls[0][0].cursor).toBeUndefined();
    expect(await held()).toBe(13);
    const row = await client.transaction.findFirstOrThrow({
      where: { plaidTransactionId: edited },
    });
    expect(row).toMatchObject({ pfcPrimary: "ENTERTAINMENT", categorySource: "user" });
    // Never twice: one row per Plaid id.
    const ids = (await client.transaction.findMany({ where: { account: { itemId } } })).map(
      (t) => t.plaidTransactionId,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      (await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } })).transactionsCursor,
    ).toBe("c-fresh");
    const note = (await latestNotes([itemId], { client })).get(itemId)!;
    expect(note.rescannedAt).toBe(LATER.toISOString());
    expect(note.status).toBe("HISTORICAL_UPDATE_COMPLETE");
    expect(note.earliest).toBe("2025-01-15");

    // Not again: the next sync resumes from the cursor.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account()],
        next_cursor: "c-next",
        status: "HISTORICAL_UPDATE_COMPLETE",
      }),
    );
    await syncItem(itemId, { client, api, now: new Date(NOW.getTime() + 86_400_000) });
    expect(transactionsSync.mock.calls[1][0].cursor).toBe("c-fresh");
    expect(await itemsStillCatchingUp({ client, now: NOW }, { equals: userId })).toEqual([]);
  });

  it("offers the one tap only when Plaid says complete, the read-again is done, and it still holds less than asked", async () => {
    // Complete, read again, and the oldest charge is Jan 2025: more than 365 days before Nov 10,
    // 2026? No: it holds what was asked, so nothing is offered.
    const done = (await historyForPerson(userId, { client, now: NOW })).find(
      (h) => h.bank === "Slow Platypus Bank",
    )!;
    expect(done.line.state).toBe("complete");
    expect(done.offer).toBe(false);

    // A link made on Oct 1 that asked for 365 days and holds from Oct 19 only.
    const other = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-short-${suffix}`,
        accessTokenEncrypted: encrypt("access-sandbox-short"),
        institutionName: "Short Bank",
        createdAt: new Date("2026-10-01T12:00:00Z"),
        transactionsCursor: "s1",
      },
    });
    const sacc = `${suffix}-short`;
    const shortTx = { ...tx("s0", "2026-10-19"), account_id: sacc };
    transactionsSync
      .mockResolvedValueOnce(
        syncPage({
          accounts: [plaidAccount({ account_id: sacc })],
          added: [shortTx],
          next_cursor: "s2",
          status: "HISTORICAL_UPDATE_COMPLETE",
        }),
      )
      .mockResolvedValueOnce(
        syncPage({
          accounts: [plaidAccount({ account_id: sacc })],
          next_cursor: "s3",
          status: "HISTORICAL_UPDATE_COMPLETE",
        }),
      );
    // First sync: no note yet, the link is old enough, so it is read again.
    await syncItem(other.id, { client, api, now: NOW });
    expect(transactionsSync.mock.calls[0][0].cursor).toBeUndefined();
    const short = (await historyForPerson(userId, { client, now: NOW })).find(
      (h) => h.bank === "Short Bank",
    )!;
    expect(short).toMatchObject({ offer: true, line: { state: "complete" } });
    expect(short.line.text).toContain("this is everything Short Bank gave");
    // The cron's second look does not read it again from the start.
    await syncItem(other.id, { client, api, now: new Date(NOW.getTime() + 86_400_000) });
    expect(transactionsSync.mock.calls[1][0].cursor).toBe("s2");
    await client.auditLog.deleteMany({ where: { targetId: other.id } });
    await client.plaidItem.delete({ where: { id: other.id } });
  });
});
