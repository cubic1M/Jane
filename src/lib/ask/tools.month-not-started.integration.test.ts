import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runAskTool } from "./tools";

// Gate E (11-16): a beta person whose only upload is October's checking statement asks on Nov 3.
// Their data ended 3 days ago, too recent for "what I have ends on", but November has nothing in it
// yet, and the tools Claude reads mustn't call that $0.00.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-03T18:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("the spending tools before this month has anything in it", () => {
  let client: PrismaClient;
  let id = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `month-not-started-${crypto.randomUUID()}@example.com` },
    });
    id = user.id;
    const account = await client.account.create({
      data: { userId: id, source: "csv", name: "Checking", type: "checking" },
    });
    const tx = (date: string, amountCents: number, description: string, pfcPrimary: string) => ({
      userId: id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}`,
      date: day(date),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary,
      pfcDetailed: null,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        tx("2026-10-01", 120_000, "AVALON PROPERTY RENT", "RENT_AND_UTILITIES"),
        tx("2026-10-02", 6_420, "TRADER JOE S #552", "FOOD_AND_DRINK"),
        tx("2026-10-15", -145_000, "ACME PAYROLL PPD", "INCOME"),
        tx("2026-10-31", 3_860, "SHELL OIL 5744", "TRANSPORTATION"),
      ],
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
  });

  const run = async (name: string, input: object = {}) =>
    JSON.parse((await runAskTool(id, name, input, { client, now: NOW })).content);

  it("says November isn't known yet and where the data ends, not $0.00", async () => {
    const november = await run("spending_by_category");
    expect(november.spending).toBeUndefined();
    expect(november.note).toBe(
      "Nothing was seen for that month, so its spending isn't known: their transactions end 2026-10-31. It isn't $0.",
    );
  });

  it("lists months up to October, with the day the data ends", async () => {
    const { months, historyEnds } = await run("monthly_totals");
    expect(months.map((m: { month: string }) => m.month)).toEqual(["2026-10"]);
    expect(historyEnds).toBe("2026-10-31");
  });

  it("still answers October", async () => {
    const october = await run("spending_by_category", { month: "2026-10" });
    expect(october.spending).toBe("$1,302.80");
  });
});
