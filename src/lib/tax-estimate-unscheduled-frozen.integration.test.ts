import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadTaxEstimate } from "./tax-estimate";

// Debug 2, sweep 13 (Plaid one month, linked): two paychecks of $688.40 every two weeks are too few for
// a schedule, and the federal estimate paced them by the days to today: $123 of tax on Nov 20, $65 on
// Nov 21, with no new data. They're a year of the profile's month now (monthsBetweenLines): data Oct
// 22 to Nov 14 is under a month, so $1,376.80 a month, $16,521.60 of take-home a year, on both days.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)(
  "the estimate's pay off any schedule, on two days",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let userId: string;

    beforeAll(async () => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      const email = "tax-unscheduled-frozen-d2@example.com";
      await client.user.deleteMany({ where: { email } });
      userId = (await client.user.create({ data: { email, createdAt: new Date("2026-11-20") } }))
        .id;
      const checking = await client.account.create({
        data: {
          userId,
          source: "plaid",
          name: "Plaid checking",
          type: "depository",
          subtype: "checking",
        },
      });
      const rows: [string, number, string, string][] = [
        ["2026-10-22", 650, "STARBUCKS", "FOOD_AND_DRINK_COFFEE"],
        ["2026-10-31", -68_840, "UC DAVIS PAYROLL PPD ID: 9460001234", "INCOME_SALARY"],
        ["2026-11-14", -68_840, "UC DAVIS PAYROLL PPD ID: 9460001234", "INCOME_SALARY"],
      ];
      for (const [date, amountCents, description, pfcDetailed] of rows) {
        await client.transaction.create({
          data: {
            userId,
            accountId: checking.id,
            source: "plaid",
            date: new Date(`${date}T00:00:00Z`),
            amountCents,
            description,
            pfcDetailed,
          },
        });
      }
    });

    afterAll(async () => {
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    });

    it("is a year of one month of pay on Nov 20 and on Nov 26", async () => {
      for (const day of ["2026-11-20", "2026-11-26"]) {
        const view = await loadTaxEstimate(userId, { client, now: new Date(`${day}T20:00:00Z`) });
        expect(view.input.income.wagesCents, day).toBe(2 * 68_840 * 12);
      }
    });
  },
);
