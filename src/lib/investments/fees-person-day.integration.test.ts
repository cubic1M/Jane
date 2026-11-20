import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadFees } from "./fees";

// The calendar sweep (12-30, the demo person): "what fees am I paying" said $738.54 at 3pm in Los
// Angeles and $694.84 at 7pm the same day, the advisory fee $124.80 against $93.60: the last 12
// months were cut at this instant a year ago, and a quarter's fee, dated a day, fell out once UTC
// had moved on to the next day. The same day reads the same at 3pm and at 7pm.

const url = process.env.TEST_DATABASE_URL;
const THREE_PM = new Date("2026-12-30T23:00:00Z");
const SEVEN_PM = new Date("2026-12-31T03:00:00Z");

describe.runIf(url)("a year of investment fees, as the person's day", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `fees-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Brokerage", type: "investment", subtype: "brokerage" },
    });
    // A quarter's advisory fee, the first a year to the day before Dec 30.
    for (const date of ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]) {
      await client.investmentTransaction.create({
        data: {
          userId,
          accountId: account.id,
          plaidInvestmentTransactionId: `csv:${userId}:${date}`,
          date: new Date(`${date}T00:00:00Z`),
          name: "ADVISORY FEE",
          quantity: 0,
          amountCents: 3_120,
          priceCents: 0,
          type: "fee",
          subtype: "management fee",
        },
      });
    }
  });

  afterAll(async () => {
    await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
  });

  it("counts the same fees at 3pm and at 7pm on Dec 30", async () => {
    const at3 = (await loadFees(userId, { client, now: THREE_PM })).fees;
    const at7 = (await loadFees(userId, { client, now: SEVEN_PM })).fees;
    expect(at3.advisoryCents).toBe(12_480);
    expect(at7.advisoryCents).toBe(at3.advisoryCents);
    expect(at7.totalYearlyCents).toBe(at3.totalYearlyCents);
  });
});
