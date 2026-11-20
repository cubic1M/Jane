import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadFees } from "./fees";

// Gate C's calendar sweep (11-20, after #2180), the demo person over data held still: "what fees am
// I paying" went $738.54 on 12-30 to $694.84 on 12-31 with nothing new, because the year was counted
// back from today and the 2025-12-31 quarter fell out of it with no new quarter to take its place.
// A year of fees ends at the newest investment line (car cover's year, #2133). For an account that
// syncs, whose newest line is today, it reads exactly as before.

const url = process.env.TEST_DATABASE_URL;
const at3pm = (day: string) => new Date(`${day}T23:00:00Z`);
const QUARTERS = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];

describe.runIf(url)(
  "a year of investment fees, ending at the newest line",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const made: string[] = [];

    beforeAll(() => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: made } } });
      await client.$disconnect();
    });

    const person = async (
      lines: { date: string; type: string; subtype: string; cents: number }[],
    ) => {
      const user = await client.user.create({
        data: {
          email: `fees-line-${crypto.randomUUID()}@example.com`,
          timezone: "America/Los_Angeles",
        },
      });
      made.push(user.id);
      const account = await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Brokerage",
          type: "investment",
          subtype: "brokerage",
        },
      });
      for (const [i, l] of lines.entries()) {
        await client.investmentTransaction.create({
          data: {
            userId: user.id,
            accountId: account.id,
            plaidInvestmentTransactionId: `csv:${user.id}:${i}`,
            date: new Date(`${l.date}T00:00:00Z`),
            name: l.type === "fee" ? "ADVISORY FEE" : "DIVIDEND",
            quantity: 0,
            amountCents: l.cents,
            priceCents: 0,
            type: l.type,
            subtype: l.subtype,
          },
        });
      }
      return user.id;
    };
    const quarter = (date: string) => ({
      date,
      type: "fee",
      subtype: "management fee",
      cents: 3_120,
    });
    const dividend = (date: string) => ({ date, type: "cash", subtype: "dividend", cents: -1_500 });
    const advisory = async (userId: string, day: string) =>
      (await loadFees(userId, { client, now: at3pm(day) })).fees.advisoryCents;

    it("reads the same year every day after the data stops", async () => {
      const userId = await person([...QUARTERS.map(quarter), dividend("2026-10-24")]);
      for (const day of ["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-02"]) {
        expect(await advisory(userId, day), day).toBe(12_480);
      }
    });

    it("reads exactly as before for an account whose newest line is today", async () => {
      // The day a year back is out and the day after it is in, as the window was counted from today.
      const userId = await person([
        quarter("2025-12-30"),
        ...QUARTERS.map(quarter),
        dividend("2026-12-30"),
      ]);
      expect(await advisory(userId, "2026-12-30")).toBe(12_480);
      const next = await person([...QUARTERS.map(quarter), quarter("2026-12-31")]);
      expect(await advisory(next, "2026-12-31")).toBe(12_480);
    });

    it("counts four quarters when a late post puts five in 365 days", async () => {
      const userId = await person(
        ["2026-01-02", "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"].map(quarter),
      );
      expect(await advisory(userId, "2027-01-01")).toBe(12_480);
    });
  },
);
