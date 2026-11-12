import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop an ACH line's entry words after the company however the bank
// abbreviates them (debugger 11-12: "Maple Court Apts Rent Web Pmts"), and the migration moves saved
// rows to the new key and name: the SQL must give each old key the key normalizeMerchant gives
// now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270516000000_merchant_without_ach_entry_words/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["MAPLE COURT APTS RENT WEB PMTS", "maple court apts rent web pmts"],
  ["DAYTON POWER LIGHT BILL PAYMT", "dayton power light bill paymt"],
  ["OHIO EDISON BILL PYMT", "ohio edison bill pymt"],
  ["CITY OF AKRON WATER BILL PMT", "city of akron water bill pmt"],
  ["COMCAST ONLINE PYMT", "comcast online pymt"],
  ["GEICO MOBILE PMTS", "geico mobile pmts"],
  ["T-MOBILE PCS SVC", "t-mobile pcs svc"],
  // Unchanged: already dropped, Chase's own line, and a name that is only the words.
  ["STATE FARM INSURANCE", "state farm insurance"],
  ["CHASE AUTOPAY", "chase autopay"],
  ["WEB PMTS", "web pmts"],
  ["VENMO PAY", "venmo pay"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without an ACH line's entry words", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_entry_words(${old}) AS key`
    )[0].key;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it.each(OLD_KEYS)("gives %s's old key the key it has now", async (description, old) => {
    expect(await sqlKey(old)).toBe(normalizeMerchant(description)?.key);
  });

  it("moves a person's category, finding and stored names", async () => {
    const user = await client.user.create({
      data: { email: `merchant-entry-words-keys-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        dedupeKey: "entry-1",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: 87_500,
        description: "MAPLE COURT APTS RENT WEB PMTS",
        merchantName: "Maple Court Apts Rent Web Pmts",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "maple court apts rent web pmts",
        source: "user",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:maple court apts rent web pmts",
        title: "Review your Maple Court Apts Rent Web Pmts subscription",
        confidence: "medium",
        status: "declined",
      },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    expect(
      (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
    ).toBe("maple court apts rent");
    expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
      key: "merchant:maple court apts rent",
      status: "declined",
    });
    expect((await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName).toBe(
      "Maple Court Apts Rent",
    );
  });
});
