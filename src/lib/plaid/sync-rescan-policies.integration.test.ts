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

// Debug 2, tenth desktop sweep (11-20 06:01 Pacific, Plaid sandbox checking + student and car
// loans): the first sync brought 30 days, with none of Progressive's monthly payments in them.
// Refresh now brought four months, and Bills listed "Progressive Insurance $154.99", but Insurance
// said "Car insurance, Not on file: … it's likely paid somewhere I can't see". Jane's run, which
// adds insurers found in the payments, says nothing in quiet hours and so stops before it. A later
// sync that brings transactions finds them itself, at any hour.

const url = process.env.TEST_DATABASE_URL;
const FIRST = new Date("2026-11-20T13:59:00Z");
// 06:01 in the Pacific time an unset timezone means: quiet hours.
const LATER = new Date("2026-11-20T14:01:00Z");

describe.runIf(url)(
  "a later sync in quiet hours and insurance in the payments",
  { timeout: 120_000 },
  () => {
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
    const account = plaidAccount({ account_id: "d2-policies-acc" });
    const row = (id: string, date: string, amount: number, name: string, detailed: string) => ({
      ...plaidTransaction({
        transaction_id: `d2-policies-${id}`,
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
      account_id: "d2-policies-acc",
    });
    const pay = (id: string, date: string) =>
      row(id, date, -861.2, "TARGET CORP PAYROLL PPD", "INCOME_WAGES");
    const premium = (id: string, date: string) =>
      row(id, date, 154.99, "PROGRESSIVE INS PREM", "GENERAL_SERVICES_INSURANCE");

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const email = "plaid-rescan-policies-d2@example.com";
      await client.user.deleteMany({ where: { email } });
      userId = (await client.user.create({ data: { email } })).id;
      itemId = (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId: "item-d2-rescan-policies",
            accessTokenEncrypted: encrypt("access-sandbox-test"),
            institutionName: "First Platypus Bank",
          },
        })
      ).id;
      await client.janeMessage.create({
        data: { userId, kind: "note", body: "Hello.", dedupeKey: "d2-rescan-policies:hello" },
      });
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [account],
          added: [pay("p3", "2026-10-30"), pay("p4", "2026-11-13")],
          next_cursor: "policies-1",
        }),
      );
      await syncItem(itemId, { client, api, now: FIRST });
    });

    afterAll(async () => {
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("adds the insurer it finds in the payments as found", async () => {
      expect(await client.insurancePolicy.count({ where: { userId } })).toBe(0);
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [account],
          added: [
            pay("p1", "2026-10-02"),
            pay("p2", "2026-10-16"),
            premium("i1", "2026-08-18"),
            premium("i2", "2026-09-18"),
            premium("i3", "2026-10-18"),
          ],
          next_cursor: "policies-2",
        }),
      );
      await syncItem(itemId, { client, api, now: LATER });
      const found = await client.insurancePolicy.findMany({
        where: { userId },
        select: { carrier: true, source: true, status: true },
      });
      expect(found).toEqual([expect.objectContaining({ source: "payments", status: "found" })]);
      expect(found[0]?.carrier).toMatch(/Progressive/);
    });
  },
);
