import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { STALE_AFTER_DAYS } from "@/profile/build";
import { addDays } from "@/lib/dates";
import { loadFees } from "./fees";

// The fee year's end day comes with the fees only when it's past STALE_AFTER_DAYS: investment data
// that stopped on Oct 23 reads "the year to Oct 23" in December, and "the last 12 months" while
// it's still recent (fees-year-to.test.ts has the words).

const url = process.env.TEST_DATABASE_URL;
const at3pm = (day: string) => new Date(`${day}T23:00:00Z`);

describe.runIf(url)("the fee year's end day", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `fees-to-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Brokerage", type: "investment", subtype: "brokerage" },
    });
    for (const date of ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30", "2026-10-23"]) {
      await client.investmentTransaction.create({
        data: {
          userId,
          accountId: account.id,
          plaidInvestmentTransactionId: `csv:${userId}:${date}`,
          date: new Date(`${date}T00:00:00Z`),
          name: date === "2026-10-23" ? "DIVIDEND" : "ADVISORY FEE",
          quantity: 0,
          amountCents: date === "2026-10-23" ? -1_500 : 3_120,
          priceCents: 0,
          type: date === "2026-10-23" ? "cash" : "fee",
          subtype: date === "2026-10-23" ? "dividend" : "management fee",
        },
      });
    }
  });

  afterAll(async () => {
    await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is the newest line's day once that's past STALE_AFTER_DAYS, and none before", async () => {
    const fresh = addDays("2026-10-23", STALE_AFTER_DAYS);
    const old = addDays("2026-10-23", STALE_AFTER_DAYS + 1);
    expect((await loadFees(userId, { client, now: at3pm(fresh) })).fees.yearTo).toBeNull();
    expect((await loadFees(userId, { client, now: at3pm(old) })).fees.yearTo).toBe("2026-10-23");
    expect((await loadFees(userId, { client, now: at3pm("2026-12-31") })).fees.advisoryCents).toBe(
      12_480,
    );
  });
});
