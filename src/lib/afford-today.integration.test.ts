import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { affordPage } from "./afford";

// Pre-deploy walk of 11-27 (older, in production): after 4pm Pacific the chat's "See the full
// check" link for a purchase today opened /afford saying "Pick a date in the next 12 months."
// with no result, because the page took UTC's day and the chat the person's own.
const url = process.env.TEST_DATABASE_URL;

describe("the afford page's day", () => {
  it("is the person's own, not UTC's (the page no longer reads it from the clock)", () => {
    const page = readFileSync(join(__dirname, "../app/afford/page.tsx"), "utf8");
    expect(page).not.toMatch(/isoDate\(now\)|toISOString\(\)\.slice\(0, 10\)/);
    expect(page).toContain("affordPage(");
  });
});

describe.runIf(url)("the same link at 3pm and at 7pm Pacific on one calendar day", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: "afford-today@example.com", timezone: "America/Los_Angeles" },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // Month end and year end: 7pm Pacific is already the next UTC day, and the next month or year.
  const DAYS = ["2026-11-26", "2026-11-30", "2026-12-31", "2027-02-28"];
  const at = (day: string, hourPacific: number) => {
    const noon = new Date(`${day}T20:00:00Z`);
    return new Date(noon.getTime() + (hourPacific - 12) * 3_600_000);
  };

  it.each(DAYS)("gives the same result for a purchase today, %s", async (day) => {
    const link = { kind: "purchase", amount: "250", date: day };
    const afternoon = await affordPage(userId, link, { client, now: at(day, 15) });
    const evening = await affordPage(userId, link, { client, now: at(day, 19) });
    for (const page of [afternoon, evening]) {
      expect(page.asOf).toBe(day);
      expect(page.query.error).toBeNull();
      expect(page.query.change).toEqual({ kind: "purchase", amountCents: 25_000, date: day });
      expect(page.query.form.date).toBe(day);
    }
    expect(evening.months).toEqual(afternoon.months);
    expect(evening.until).toBe(afternoon.until);
    // The window opens on today's date: it can be picked in the date field.
    expect(evening.months[0]).toBe(day.slice(0, 7));
  });

  it("still refuses yesterday, and defaults the date to the person's today", async () => {
    const now = at("2026-11-26", 19);
    const yesterday = await affordPage(
      userId,
      { kind: "purchase", amount: "250", date: "2026-11-25" },
      { client, now },
    );
    expect(yesterday.query.error).toBe("Pick a date in the next 12 months.");
    const blank = await affordPage(userId, {}, { client, now });
    expect(blank.query.form.date).toBe("2026-11-26");
  });
});
