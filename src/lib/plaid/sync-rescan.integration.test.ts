import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { plaidAccount, plaidTransaction, syncPage } from "@/data-sources/plaid/__fixtures__/plaid";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "./sync";

// Debug 2 re-walk (11-16, Plaid sandbox checking + student and car loan, 1280 light): the first
// sync brought 30 days, and the day's cards were scanned on them ("3 accounts in 1 month of
// data", "could drop to -$272.26 around Dec 14 if no pay comes in"). The rest of the history came
// on the next sync (Plaid's own later update, or Refresh now) and the cards stayed as they were
// until the night's run, though the paydays had come in. An upload rescans after new
// transactions; a sync that changes them now does too.

const url = process.env.TEST_DATABASE_URL;
const FIRST = new Date("2026-11-16T20:51:00Z");
const LATER = new Date("2026-11-16T20:53:00Z");
const LATEST = new Date("2026-11-16T20:55:00Z");

describe.runIf(url)("a later sync and the day's suggestions", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let itemId: string;
  const transactionsSync = vi.fn();
  const none = vi.fn(async () => {
    throw new Error("not asked for");
  });
  const api = {
    transactionsSync,
    transactionsRecurringGet: vi.fn(async () => ({
      data: { outflow_streams: [], inflow_streams: [] },
    })),
    liabilitiesGet: none,
    investmentsHoldingsGet: none,
    investmentsTransactionsGet: none,
  } as unknown as PlaidApi;
  const account = plaidAccount({ account_id: "d2-rescan-acc" });
  const row = (id: string, date: string, amount: number, name: string, detailed: string) => ({
    ...plaidTransaction({
      transaction_id: `d2-rescan-${id}`,
      date,
      amount,
      name,
      merchant_name: null,
      personal_finance_category: {
        primary: detailed.replace(/_(WAGES|RENT)$/, ""),
        detailed,
        confidence_level: "HIGH",
      },
    }),
    account_id: "d2-rescan-acc",
  });
  const pay = (id: string, date: string) =>
    row(id, date, -688.4, "TARGET CORP PAYROLL PPD", "INCOME_WAGES");
  const rent = (id: string, date: string) =>
    row(id, date, 1125, "ZELLE TO JORDAN P RENT", "RENT_AND_UTILITIES_RENT");

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: "plaid-rescan-d2@example.com" } })).id;
    itemId = (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: "item-d2-rescan",
          accessTokenEncrypted: encrypt("access-sandbox-test"),
          institutionName: "First Platypus Bank",
        },
      })
    ).id;
    // Jane has spoken to them already: the chat's own first scan (src/lib/jane-agent/run.ts) isn't
    // what this is about.
    await client.janeMessage.create({
      data: { userId, kind: "note", body: "Hello.", dedupeKey: "d2-rescan:hello" },
    });
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account],
        added: [pay("p3", "2026-10-31"), rent("r2", "2026-11-01"), pay("p4", "2026-11-14")],
        next_cursor: "rescan-1",
      }),
    );
    await syncItem(itemId, { client, api, now: FIRST });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // When the day's suggestions were last scanned: every row a scan finds is stamped with its time.
  const lastScanned = async () =>
    (await client.suggestion.aggregate({ where: { userId }, _max: { lastSeenAt: true } }))._max
      .lastSeenAt;

  it("rescans them when it brings transactions in", async () => {
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account],
        added: [pay("p1", "2026-10-03"), rent("r1", "2026-10-01"), pay("p2", "2026-10-17")],
        next_cursor: "rescan-2",
      }),
    );
    await syncItem(itemId, { client, api, now: LATER });
    expect(await lastScanned()).toEqual(LATER);
  });

  it("leaves them when nothing changed", async () => {
    transactionsSync.mockResolvedValueOnce(
      syncPage({ accounts: [account], added: [], next_cursor: "rescan-3" }),
    );
    await syncItem(itemId, { client, api, now: LATEST });
    expect(await lastScanned()).toEqual(LATER);
  });
});
