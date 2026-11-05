import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadTaxEstimate } from "./tax-estimate";

// Debugger 11-05: someone laid off in June read as paid to December, and the $12,000 they took out
// of their 401(k) wasn't counted at all.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T15:00:00Z");
const PAY = 240_000;
const WITHDRAWAL = 1_200_000;

describe.runIf(url)("the tax estimate after a job ends", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("stops the pay where it stopped, and counts a 401(k) withdrawal once", async () => {
    const user = await client.user.create({
      data: { email: `tax-job-loss-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const row = (date: string, amountCents: number, description: string, pfc: string | null) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          merchantName: description.startsWith("NORTHWIND") ? "Northwind Payroll" : null,
          pfcPrimary: pfc?.split("_")[0] ?? null,
          pfcDetailed: pfc,
        },
      });
    const paydays = ["2026-01-09", "2026-02-06", "2026-03-06", "2026-04-03", "2026-05-01"];
    for (const day of [...paydays, "2026-06-26"]) {
      await row(day, -PAY, "NORTHWIND PAYROLL", "INCOME_SALARY");
    }
    await row("2026-09-15", -WITHDRAWAL, "FIDELITY 401K DISTRIB", "INCOME_RETIREMENT_PENSION");
    await row("2026-10-30", 5_000, "TRADER JOE S", "FOOD_AND_DRINK_GROCERIES");

    const view = (await loadTaxEstimate(user.id, { client, now: NOW }))!;
    expect(view.input.income.wagesCents).toBe(6 * PAY);
    expect(view.input.income.retirementCents).toBe(WITHDRAWAL);
    expect(view.assumptions.join(" ")).toMatch(/I don't see pay from Northwind since /);
    expect(view.assumptions.join(" ")).toMatch(/\$12,000\.00 you took out of your 401\(k\)/);
  });
});
