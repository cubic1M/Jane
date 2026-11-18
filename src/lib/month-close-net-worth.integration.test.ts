import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadClose, runMonthClose } from "./month-close";

// Debug 2, fifth desktop sweep (11-18, upload S5: one month of Wells Fargo checking, $642.18
// entered as today's balance): October closed on Nov 18 with "Net worth at the close: $642.18",
// today's balance, while Ahead said "Down $273 since the end of last month" (Oct 31: $915.16).
// The close says net worth at the month's end, from each account's last balance by then.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T19:00:00Z");

describe.runIf(url)("net worth at a month's close taken weeks later", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const email = "month-close-net-worth@example.com";
    await client.user.deleteMany({ where: { email } });
    userId = (await client.user.create({ data: { email } })).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Wells Fargo checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 64_218,
      },
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
        row("2026-10-16", "CAMPUS DINING PAYROLL PPD", -71_250, "INCOME_SALARY"),
        row("2026-10-20", "SAFEWAY #0921 DAVIS CA", 3_720, "FOOD_AND_DRINK_GROCERIES"),
        row("2026-10-30", "CAMPUS DINING PAYROLL PPD", -70_980, "INCOME_SALARY"),
        row("2026-11-01", "VENMO PAYMENT 1023 RENT ALEX K", 85_000, "RENT_AND_UTILITIES_RENT"),
        row("2026-11-13", "CAMPUS DINING PAYROLL PPD", -72_110, "INCOME_SALARY"),
      ],
    });
    await client.balanceSnapshot.createMany({
      data: [
        {
          userId,
          accountId: account.id,
          date: new Date("2026-10-31T00:00:00Z"),
          balanceCents: 91_516,
        },
        {
          userId,
          accountId: account.id,
          date: new Date("2026-11-14T00:00:00Z"),
          balanceCents: 64_218,
        },
      ],
    });
  });
  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is Oct 31's, not the day it closed", async () => {
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("closed");
    const close = await loadClose(userId, { client });
    expect(close?.month).toBe("2026-10");
    expect(close?.figures.netWorthCents).toBe(91_516);
  });
});
