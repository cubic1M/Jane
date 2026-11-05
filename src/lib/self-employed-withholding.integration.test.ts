import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadSelfEmployed } from "./self-employed";

// Debugger 11-05: "Tax payments $5,040.56" planned for January, all the tax on someone's wages,
// because Jane can see paychecks and not what's withheld from them.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T15:00:00Z");
const PAYDAYS = ["01-09", "03-06", "05-01", "07-03", "09-04", "10-30"];

describe.runIf(url)("planned tax payments when withholding isn't known", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person(extra: { date: string; cents: number; pfc: string; what: string }[]) {
    const user = await client.user.create({
      data: { email: `se-withheld-${crypto.randomUUID()}@example.com` },
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
    const rows = [
      ...PAYDAYS.map((day) => ({
        date: `2026-${day}`,
        cents: -1_000_000,
        pfc: "INCOME_SALARY",
        what: "NORTHWIND PAYROLL",
      })),
      ...extra,
    ];
    for (const r of rows) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${r.date}T00:00:00Z`),
          amountCents: r.cents,
          description: r.what,
          pfcPrimary: r.pfc.split("_")[0],
          pfcDetailed: r.pfc,
        },
      });
    }
    return user.id;
  }

  it("plans nothing for pay alone", async () => {
    const view = await loadSelfEmployed(await person([]), { client, now: NOW });
    expect(view.estimate.withholdingKnown).toBe(false);
    expect(view.estimate.estimate.totalTaxCents).toBeGreaterThan(100_000);
    expect(view.federal).toMatchObject({ needed: false, owedCents: 0 });
  });

  it("plans only the tax on income with nothing taken out", async () => {
    const view = await loadSelfEmployed(
      await person([
        {
          date: "2026-09-15",
          cents: -2_000_000,
          pfc: "INCOME_RETIREMENT_PENSION",
          what: "FIDELITY 401K DISTRIB",
        },
      ]),
      { client, now: NOW },
    );
    expect(view.federal.needed).toBe(true);
    expect(view.federal.owedCents).toBeGreaterThan(0);
    expect(view.federal.owedCents).toBeLessThan(view.estimate.estimate.totalTaxCents);
  });
});
