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

// Debug 2, sweep 12 (11-20, 22:57 Pacific, Plaid sandbox checking + student and car loans): Bills
// listed "Progressive Insurance $154.99" a month and Insurance said car cover was "Not on file", on
// 2 of 4 links of the same sandbox person, and Settings › Refresh now never mended it. Insurers in
// the payments were added only by Jane's run (which says nothing in quiet hours) or by a later sync
// that changed transactions (#2182), so rows stored while no policy step read them stayed short.
// The rule (manager, 11-20): once a scan is done, the policies found are what a fresh look at the
// stored rows finds, and a refresh that brings nothing new repairs them.

const url = process.env.TEST_DATABASE_URL;
// 22:57 and 23:05 in the Pacific time an unset timezone means: quiet hours.
const FIRST = new Date("2026-11-21T06:57:00Z");
const LATER = new Date("2026-11-21T07:05:00Z");

describe.runIf(url)(
  "insurers in the payments, whichever save brought them",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const transactionsSync = vi.fn();
    const none = vi.fn(async () => {
      throw new Error("not asked for");
    });
    let midScan: (() => Promise<void>) | null = null;
    const api = {
      transactionsSync,
      // Called in the first scan after its rows are saved and before detection: where a second
      // save lands in the middle of it.
      transactionsRecurringGet: vi.fn(async () => {
        if (midScan) await midScan();
        return { data: { outflow_streams: [], inflow_streams: [] } };
      }),
      liabilitiesGet: none,
      investmentsHoldingsGet: none,
      investmentsTransactionsGet: none,
    } as unknown as PlaidApi;
    const row = (
      acc: string,
      id: string,
      date: string,
      amount: number,
      name: string,
      detailed: string,
    ) => ({
      ...plaidTransaction({
        transaction_id: `d2-repair-${acc}-${id}`,
        date,
        amount,
        name,
        merchant_name: null,
        personal_finance_category: {
          primary: detailed.replace(/_(WAGES|INSURANCE)$/, ""),
          detailed,
          confidence_level: "HIGH",
        },
      }),
      account_id: acc,
    });
    const pay = (acc: string, id: string, date: string) =>
      row(acc, id, date, -861.2, "TARGET CORP PAYROLL PPD", "INCOME_WAGES");
    const PREMIUMS = ["2026-08-18", "2026-09-18", "2026-10-18"];
    // The premiums saved straight into the table, as a save no policy step read.
    const savePremiums = async (userId: string, plaidAccountId: string) => {
      const account = await client.account.findFirstOrThrow({ where: { userId, plaidAccountId } });
      for (const [i, date] of PREMIUMS.entries()) {
        await client.transaction.create({
          data: {
            userId,
            accountId: account.id,
            source: "plaid",
            plaidTransactionId: `d2-repair-${plaidAccountId}-saved-${i}`,
            date: new Date(`${date}T00:00:00Z`),
            amountCents: 15_499,
            description: "PROGRESSIVE INS PREM",
            pfcPrimary: "GENERAL_SERVICES",
            pfcDetailed: "GENERAL_SERVICES_INSURANCE",
          },
        });
      }
    };
    const person = async (key: string) => {
      const email = `plaid-policies-repair-${key}-d2@example.com`;
      await client.user.deleteMany({ where: { email } });
      const userId = (await client.user.create({ data: { email } })).id;
      const itemId = (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId: `item-d2-policies-repair-${key}`,
            accessTokenEncrypted: encrypt("access-sandbox-test"),
            institutionName: "First Platypus Bank",
          },
        })
      ).id;
      return { userId, itemId };
    };
    const found = (userId: string) =>
      client.insurancePolicy.findMany({
        where: { userId },
        select: { carrier: true, source: true, status: true },
      });

    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });

    afterAll(async () => {
      await client.user.deleteMany({ where: { email: { startsWith: "plaid-policies-repair-" } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("a refresh that brings nothing new adds the insurer its stored rows show", async () => {
      const { userId, itemId } = await person("refresh");
      const acc = "d2-repair-refresh-acc";
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [plaidAccount({ account_id: acc })],
          added: [pay(acc, "p1", "2026-10-30"), pay(acc, "p2", "2026-11-13")],
          next_cursor: "repair-1",
        }),
      );
      await syncItem(itemId, { client, api, now: FIRST });
      await savePremiums(userId, acc);
      expect(await found(userId)).toEqual([]);
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [plaidAccount({ account_id: acc })],
          added: [],
          next_cursor: "repair-2",
        }),
      );
      await syncItem(itemId, { client, api, now: LATER });
      const policies = await found(userId);
      expect(policies).toEqual([expect.objectContaining({ source: "payments", status: "found" })]);
      expect(policies[0]?.carrier).toMatch(/Progressive/);
    });

    it("the first scan ends with the insurer a save in the middle of it brought", async () => {
      const { userId, itemId } = await person("first-scan");
      const acc = "d2-repair-first-acc";
      midScan = () => savePremiums(userId, acc);
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [plaidAccount({ account_id: acc })],
          added: [pay(acc, "p1", "2026-10-30"), pay(acc, "p2", "2026-11-13")],
          next_cursor: "repair-first-1",
        }),
      );
      await syncItem(itemId, { client, api, now: FIRST, progressive: true });
      midScan = null;
      const policies = await found(userId);
      expect(policies).toEqual([expect.objectContaining({ source: "payments", status: "found" })]);
    });
  },
);
