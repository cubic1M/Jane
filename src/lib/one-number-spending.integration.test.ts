import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { INSIGHT_MONTHS } from "@/config/insights";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { loadHubAreas } from "@/lib/hub/load";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadClose, runMonthClose } from "@/lib/month-close";
import { formatCents } from "@/lib/money";
import { monthlyReportFor } from "@/lib/monthly-report";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate B, "one number, one source" (docs/one-number.md): a month's spending and income are what
// spendingInsights makes of the Money page's rows (loadInsightTransactions: an account linked
// twice counted once), on Home's Money tile, in the chat's monthly totals and categories, at the
// month close and in the monthly report. The chat read every row, so a bank linked again doubled
// it; the close summed its own, refunds not netted.

const url = process.env.TEST_DATABASE_URL;
// Wednesday Nov 4, 2026, 9am in Los Angeles: October is closed and its report made.
const NOW = new Date("2026-11-04T17:00:00Z");
const OCTOBER = "2026-10";

describe.runIf(url)("a month's spending, one number", { timeout: 300_000 }, () => {
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
      data: { email: `one-number-spend-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };

  const expectOneSpending = async (userId: string) => {
    const o = { client, now: NOW };
    const truth = spendingInsights(
      await loadInsightTransactions(scopedFor(userId, client), "2026-11-04", INSIGHT_MONTHS),
      { asOf: "2026-11-04", monthCount: INSIGHT_MONTHS },
    );
    const october = truth.months.find((m) => m.month === OCTOBER)!;
    const [areas, totals, categories] = await Promise.all([
      loadHubAreas(userId, { budgetsOver: 0, safeShort: false }, o),
      runChatTool(userId, "monthly_totals", {}, o),
      runChatTool(userId, "spending_by_category", { month: OCTOBER }, o),
    ]);
    await runMonthClose(userId, o);
    const [close, report] = await Promise.all([
      loadClose(userId, { client, month: OCTOBER }),
      monthlyReportFor(userId, o),
    ]);
    const chatMonth = (
      JSON.parse(totals.content) as { months: { month: string; spending: string }[] }
    ).months.find((m) => m.month === OCTOBER);
    const byCategory = JSON.parse(categories.content) as { spending?: string };
    const said = (words: string | undefined) =>
      words === formatCents(october.spendingCents) ? october.spendingCents : (words ?? null);
    expect({
      "home money tile": areas.money?.months.find((m) => m.month === OCTOBER)?.spendingCents,
      "chat monthly totals": said(chatMonth?.spending),
      "chat categories": said(byCategory.spending),
      "month close spent": close?.figures.spendingCents ?? null,
      "month close income": close?.figures.incomeCents ?? null,
      "monthly report spent": report?.report.spent?.cents ?? null,
      "monthly report earned": report?.report.earnedCents ?? null,
    }).toEqual({
      "home money tile": october.spendingCents,
      "chat monthly totals": october.spendingCents,
      "chat categories": october.spendingCents,
      "month close spent": october.spendingCents,
      "month close income": october.incomeCents,
      "monthly report spent": october.spendingCents,
      "monthly report earned": october.incomeCents,
    });
    return october;
  };

  it.each(PEOPLE.map((p) => p.id))("%s: October is one figure everywhere", async (id) => {
    const userId = await user(id);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    await expectOneSpending(userId);
  });

  it("nets a refund and counts a bank linked twice once, everywhere", async () => {
    const userId = await user("relinked");
    const item = async (n: string) =>
      (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId: `item-spend-${n}`,
            accessTokenEncrypted: encrypt(`access-spend-${n}`),
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
            plaidAccountId: `spend-${n}`,
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
    // October: $1,250 of pay, $300 of groceries, a $120 jacket and the jacket returned.
    const rows = (accountId: string, tag: string) =>
      [
        ["2026-10-01", -125_000, "ACME PAYROLL", "INCOME", "INCOME_SALARY"],
        ["2026-10-05", 30_000, "SAFEWAY STORE", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"],
        [
          "2026-10-09",
          12_000,
          "REI",
          "GENERAL_MERCHANDISE",
          "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
        ],
        [
          "2026-10-20",
          -12_000,
          "REI REFUND",
          "GENERAL_MERCHANDISE",
          "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
        ],
      ].map(([date, amountCents, description, pfcPrimary, pfcDetailed], i) => ({
        userId,
        accountId,
        source: "plaid" as const,
        plaidTransactionId: `spend-${tag}-${i}`,
        date: new Date(`${date}T00:00:00Z`),
        amountCents: amountCents as number,
        description: description as string,
        pfcPrimary: pfcPrimary as string,
        pfcDetailed: pfcDetailed as string,
        pending: false,
        categorySource: "plaid" as const,
      }));
    await client.transaction.createMany({
      data: [...rows(first, "first"), ...rows(again, "again")],
    });
    expect(await expectOneSpending(userId)).toMatchObject({
      spendingCents: 30_000,
      incomeCents: 125_000,
    });
  });
});
