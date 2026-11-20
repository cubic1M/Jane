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
// loans): the first sync brought 30 days and the first scan's dock card said "Plaid checking could
// drop to -$272.26 around Dec 18 if no pay comes in". Refresh now brought four months of
// paychecks, and the rescan removed that finding, but its card stayed in the dock: Jane's run, which
// puts away the cards of findings no longer open, says nothing in quiet hours and so stops before
// it. A later sync puts them away itself, at any hour.

const url = process.env.TEST_DATABASE_URL;
const FIRST = new Date("2026-11-20T13:59:00Z");
// 06:01 in the Pacific time an unset timezone means: quiet hours.
const LATER = new Date("2026-11-20T14:01:00Z");

describe.runIf(url)(
  "a later sync in quiet hours and a removed finding's card",
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
    const account = plaidAccount({ account_id: "d2-cards-acc" });
    const pay = (id: string, date: string) => ({
      ...plaidTransaction({
        transaction_id: `d2-cards-${id}`,
        date,
        amount: -861.2,
        name: "TARGET CORP PAYROLL PPD",
        merchant_name: null,
        personal_finance_category: {
          primary: "INCOME",
          detailed: "INCOME_WAGES",
          confidence_level: "HIGH",
        },
      }),
      account_id: "d2-cards-acc",
    });

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const email = "plaid-rescan-cards-d2@example.com";
      await client.user.deleteMany({ where: { email } });
      userId = (await client.user.create({ data: { email } })).id;
      itemId = (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId: "item-d2-rescan-cards",
            accessTokenEncrypted: encrypt("access-sandbox-test"),
            institutionName: "First Platypus Bank",
          },
        })
      ).id;
      await client.janeMessage.create({
        data: { userId, kind: "note", body: "Hello.", dedupeKey: "d2-rescan-cards:hello" },
      });
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [account],
          added: [pay("p3", "2026-10-30"), pay("p4", "2026-11-13")],
          next_cursor: "cards-1",
        }),
      );
      await syncItem(itemId, { client, api, now: FIRST });
    });

    afterAll(async () => {
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("puts the card away when the sync's rescan removed its finding", async () => {
      // The first scan's finding and its card, as the first sync left them.
      const finding = await client.finding.create({
        data: {
          userId,
          type: "low_balance_risk",
          key: "account:first-scan",
          title: "Plaid checking could drop to -$272.26 around Dec 18 if no pay comes in",
          confidence: "low",
        },
      });
      const card = await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: "Plaid checking could drop to -$272.26 around Dec 18 if no pay comes in.",
          refs: { findingId: finding.id, fingerprint: "first-scan" },
          actions: [{ id: "finding.yes", label: "Show me how", kind: "primary" }],
          dedupeKey: `findings:${finding.id}`,
          createdAt: FIRST,
        },
      });
      transactionsSync.mockResolvedValueOnce(
        syncPage({
          accounts: [account],
          added: [pay("p1", "2026-10-02"), pay("p2", "2026-10-16")],
          next_cursor: "cards-2",
        }),
      );
      await syncItem(itemId, { client, api, now: LATER });
      expect(await client.finding.findUnique({ where: { id: finding.id } })).toBeNull();
      expect((await client.janeMessage.findUnique({ where: { id: card.id } }))?.status).toBe(
        "answered",
      );
    });
  },
);
