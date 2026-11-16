import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { runDetection } from "@/detection/engine";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";

// Gate B, "one number, one source" (docs/one-number.md): bank fees Jane finds are on the report, in
// the dock and on the Spending & bills tree, or on none of them, at one figure. The report found any
// fee; the dock's card (which the tree lists) needed two in the year, so one $35 overdraft was
// "Money found $35/yr" on Home and nowhere on the Spending page (debug 2, 11-16). Now both read the
// report's rule (bankFeesByAccount): one fee counts, once.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T17:00:00Z");

describe.runIf(url)("bank fees, shown in one place and all of them", { timeout: 300_000 }, () => {
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
      data: { email: `one-number-fee-shown-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };

  // Where bank fees show, and at what figure a year: the report, the dock, the Spending tree.
  const feesShown = async (userId: string) => {
    const o = { client, now: NOW };
    await runDetection(userId, o);
    await scanSuggestions(userId, o);
    const [findings, dock, money] = await Promise.all([
      client.finding.findMany({
        where: { userId, type: "bank_fees", status: { in: ["new", "shown"] } },
        select: { annualSavingsCents: true },
      }),
      client.suggestion.findFirst({ where: { userId, topic: "bank_fees" } }),
      loadMoneyArea(userId, o),
    ]);
    const tree = money!.suggestions.find((s) => s.topic === "bank_fees");
    return {
      report:
        findings.length === 0
          ? null
          : findings.reduce((sum, f) => sum + (f.annualSavingsCents ?? 0), 0),
      dock: dock?.worthCents ?? null,
      tree: tree?.worthCents ?? null,
    };
  };

  it.each(PEOPLE.map((p) => p.id))("%s: on all three or none", async (id) => {
    const userId = await user(id);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    const shown = await feesShown(userId);
    expect(shown).toEqual({ report: shown.report, dock: shown.report, tree: shown.report });
  });

  it("shows one $35 overdraft everywhere, once, not as a yearly habit", async () => {
    const userId = await user("one-overdraft");
    const { id: itemId } = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: "item-fee-shown",
        accessTokenEncrypted: encrypt("access-fee-shown"),
        institutionName: "Wells Fargo",
      },
    });
    const { id: accountId } = await client.account.create({
      data: {
        userId,
        itemId,
        source: "plaid",
        plaidAccountId: "fee-shown",
        name: "Everyday Checking",
        mask: "5150",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 84_000,
      },
    });
    // Groceries each month since June, and one overdraft fee in September.
    const rows = [
      ...["06", "07", "08", "09", "10"].map((m) => ({
        date: `2026-${m}-09`,
        amountCents: 18_500,
        description: "SAFEWAY STORE",
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      })),
      {
        date: "2026-09-14",
        amountCents: 3_500,
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      },
    ].map((r, i) => ({
      ...r,
      userId,
      accountId,
      source: "plaid" as const,
      plaidTransactionId: `fee-shown-${i}`,
      date: new Date(`${r.date}T00:00:00Z`),
      pending: false,
      categorySource: "plaid" as const,
    }));
    await client.transaction.createMany({ data: rows });
    expect(await feesShown(userId)).toEqual({ report: 3_500, dock: 3_500, tree: 3_500 });
  });
});
