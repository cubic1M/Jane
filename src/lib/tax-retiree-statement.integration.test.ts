import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadTaxEstimate } from "./tax-estimate";

// Debugger 11-06: a retiree's uploaded statement, where the categorizer files Social Security as a
// pension (src/categorize/rule-lists/1-bank-loans-income.ts). The estimate counted it twice: in full
// as a pension, then its taxable part again, and read $88,086 of income for about $65,500.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-06T18:00:00Z");
const PENSION = 312_455;
const SOCIAL_SECURITY = 241_800;

describe.runIf(url)("a retiree's tax estimate from a statement", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("counts Social Security once, only its taxable part", async () => {
    const user = await client.user.create({
      data: { email: `tax-retiree-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const row = (date: string, amountCents: number, description: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_RETIREMENT_PENSION",
        },
      });
    for (let month = 1; month <= 10; month++) {
      const mm = String(month).padStart(2, "0");
      await row(`2026-${mm}-01`, -PENSION, "CALSTRS PENSION PAYMENT");
      await row(`2026-${mm}-03`, -SOCIAL_SECURITY, "SSA TREAS 310 XXSOC SEC");
    }

    const view = (await loadTaxEstimate(user.id, { client, now: NOW }))!;
    const { income } = view.input;
    const paced = (cents: number) => Math.round((10 * cents) / view.elapsed);
    expect(income.socialSecurityBenefitsCents).toBe(paced(SOCIAL_SECURITY));
    // The pension alone, not the pension and Social Security.
    expect(income.retirementCents).toBe(paced(PENSION));
    expect(view.estimate.socialSecurityTaxableCents).toBeLessThan(
      income.socialSecurityBenefitsCents!,
    );
    expect(view.estimate.totalIncomeCents).toBeLessThan(paced(PENSION + SOCIAL_SECURITY));
  });
});
