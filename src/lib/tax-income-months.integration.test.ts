import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadTaxSetAside } from "./tax-set-aside";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox, one checking account linked Oct 18 –
// Nov 14): Taxes said "Only 2 months of income are in your accounts" for 28 days with two
// paychecks (Oct 31 and Nov 14), while the dock said "1 month of data". The months of income are
// never more than the months the data covers.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T19:00:00Z");

describe.runIf(url)("the months of income Taxes counts", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const email = "tax-income-months@example.com";
    await client.user.deleteMany({ where: { email } });
    const user = await client.user.create({ data: { email } });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const row = (date: string, description: string, amountCents: number, pfc: string) => ({
      userId,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      pfcPrimary: pfc.split("_")[0],
      pfcDetailed: pfc,
    });
    await client.transaction.createMany({
      data: [
        row("2026-10-18", "Safeway", 2_816, "FOOD_AND_DRINK_GROCERIES"),
        row("2026-10-31", "UC DAVIS PAYROLL PPD ID: 9460001234", -68_840, "INCOME_SALARY"),
        row("2026-11-01", "ZELLE TO RIVERA K RENT", 87_500, "RENT_AND_UTILITIES_RENT"),
        row("2026-11-14", "UC DAVIS PAYROLL PPD ID: 9460001234", -68_840, "INCOME_SALARY"),
      ],
    });
  });
  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("says one month for paychecks in two calendar months but 28 days of data", async () => {
    const { unknowns } = await loadTaxSetAside(userId, { client, now: NOW });
    expect(unknowns).toContain(
      "Only 1 month of income is in your accounts, so the year's pace is a rough guess.",
    );
  });
});
