import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addDays } from "@/detection/units";
import { loadTaxSetAside } from "./tax-set-aside";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox, checking + student and car loans linked
// Jul 24 – Nov 14, seen Nov 17): Taxes said "Only 3 months of income are in your accounts" while
// the dock said "3 accounts in 4 months of data". A linked bank's statements reach today while
// its newest line is recent, as the profile counts them (src/profile/build.ts statementsEnd), not
// its newest line.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T19:00:00Z");

describe.runIf(url)(
  "the months of income Taxes counts for a linked bank",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let userId = "";

    beforeAll(async () => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const email = "tax-income-months-linked@example.com";
      await client.user.deleteMany({ where: { email } });
      userId = (await client.user.create({ data: { email } })).id;
      const account = await client.account.create({
        data: {
          userId,
          source: "plaid",
          name: "Plaid checking",
          type: "depository",
          subtype: "checking",
        },
      });
      const row = (date: string, description: string, amountCents: number, pfc: string) => ({
        userId,
        accountId: account.id,
        source: "plaid" as const,
        date: new Date(`${date}T00:00:00Z`),
        description,
        amountCents,
        pfcPrimary: pfc.split("_")[0],
        pfcDetailed: pfc,
      });
      const rows = [row("2026-11-14", "T-Mobile", 7_000, "RENT_AND_UTILITIES_TELEPHONE")];
      // Every other Friday from Jul 24 to Nov 13, as the sandbox's Target paychecks.
      for (let n = 0; n < 9; n += 1)
        rows.push(
          row(addDays("2026-07-24", 14 * n), "TARGET CORP PAYROLL PPD", -86_120, "INCOME_SALARY"),
        );
      await client.transaction.createMany({ data: rows });
    });
    afterAll(async () => {
      if (userId) await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    });

    it("says four months, as the dock does", async () => {
      const { unknowns } = await loadTaxSetAside(userId, { client, now: NOW });
      expect(unknowns).toContain(
        "Only 4 months of income are in your accounts, so the year's pace is a rough guess.",
      );
    });
  },
);
