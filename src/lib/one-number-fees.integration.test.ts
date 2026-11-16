import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { runDetection } from "@/detection/engine";
import { loadBankFees } from "@/lib/bank-fees";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";

// Gate B, "one number, one source" (docs/one-number.md): bank fees a year are one figure on the
// report (a finding per account), in the dock (the bank-fee suggestion) and in the chat (the
// open_findings tool's bankFeesAYear). The report paced fees only under 200 days of history, the
// dock under a year over the profile's months, the chat over calendar months with an account
// linked twice counted twice; eight months of $12 fees read $96, $144 and $288.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T17:00:00Z");

describe.runIf(url)("bank fees, one number", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const user = async (name: string) => {
    const row = await client.user.create({
      data: { email: `one-number-fees-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };

  // The report's findings added up, the dock's suggestion and the chat's figure; null where a
  // surface says nothing (the dock needs a few fees before it suggests anything).
  const feesEverywhere = async (userId: string) => {
    const o = { client, now: NOW };
    await runDetection(userId, o);
    await scanSuggestions(userId, o);
    const [findings, suggestion, chat] = await Promise.all([
      client.finding.findMany({
        where: { userId, type: "bank_fees" },
        select: { annualSavingsCents: true },
      }),
      client.suggestion.findFirst({
        where: { userId, topic: "bank_fees" },
        select: { worthCents: true },
      }),
      loadBankFees(userId, o),
    ]);
    return {
      report:
        findings.length === 0
          ? null
          : findings.reduce((sum, f) => sum + (f.annualSavingsCents ?? 0), 0),
      dock: suggestion?.worthCents ?? null,
      chat: chat?.yearCents ?? null,
    };
  };

  it.each(PEOPLE.map((p) => p.id))("%s: one yearly figure for bank fees", async (id) => {
    const userId = await user(id);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    const { report, dock, chat } = await feesEverywhere(userId);
    expect(chat).toBe(report);
    if (dock !== null) expect(dock).toBe(report);
  });

  it("paces eight months of fees to a year everywhere, once for a bank linked twice", async () => {
    const userId = await user("eight-months");
    const item = async (n: string) =>
      (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId: `item-fees-${n}`,
            accessTokenEncrypted: encrypt(`access-fees-${n}`),
            institutionName: "Chase",
          },
        })
      ).id;
    const account = async (itemId: string, n: string) =>
      (
        await client.account.create({
          data: {
            userId,
            itemId,
            source: "plaid",
            plaidAccountId: `fees-${n}`,
            name: "Total Checking",
            mask: "4321",
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 250_000,
          },
        })
      ).id;
    const first = await account(await item("first"), "first");
    const again = await account(await item("again"), "again");
    // Mar 10 to Oct 10: a $12 monthly fee and groceries each month, about eight months of
    // history; an $35 overdraft given back two days later counts for nothing.
    const months = ["03", "04", "05", "06", "07", "08", "09", "10"];
    const rows = (accountId: string, tag: string) =>
      [
        ...months.flatMap((m) => [
          {
            date: `2026-${m}-10`,
            amountCents: 1_200,
            description: "MONTHLY SERVICE FEE",
            pfcPrimary: "BANK_FEES",
            pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
          },
          {
            date: `2026-${m}-12`,
            amountCents: 8_450,
            description: "SAFEWAY STORE",
            pfcPrimary: "FOOD_AND_DRINK",
            pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
          },
        ]),
        {
          date: "2026-09-03",
          amountCents: 3_500,
          description: "OVERDRAFT FEE",
          pfcPrimary: "BANK_FEES",
          pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
        },
        {
          date: "2026-09-05",
          amountCents: -3_500,
          description: "OVERDRAFT FEE REVERSAL",
          pfcPrimary: "BANK_FEES",
          pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
        },
      ].map((r, i) => ({
        ...r,
        userId,
        accountId,
        source: "plaid" as const,
        plaidTransactionId: `fees-${tag}-${i}`,
        date: new Date(`${r.date}T00:00:00Z`),
        pending: false,
        categorySource: "plaid" as const,
      }));
    await client.transaction.createMany({
      data: [...rows(first, "first"), ...rows(again, "again")],
    });

    // Eight $12 fees over the eight months from Mar 10, at a year's pace (main: $96, $144, $288).
    expect(await feesEverywhere(userId)).toEqual({ report: 14_400, dock: 14_400, chat: 14_400 });
  });
});
