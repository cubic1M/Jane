import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop the IRS's "USATAXPYMT" (debugger 11-01: the tax pack listed
// "IRS Usataxpymt"), and the migration moves saved rows to the new key and name: the SQL must
// give each old key the key normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270420000000_merchant_irs_tax_payment/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["IRS USATAXPYMT", "irs usataxpymt"],
  ["Withdrawal to IRS USATAXPYMT", "irs usataxpymt"],
  ["ACH DEBIT IRS USATAXPYMT", "ach debit irs usataxpymt"],
  ["USATAXPYMT", "usataxpymt"],
  ["IRS TREAS 310 TAX REF", "irs treas tax ref"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without the IRS's USATAXPYMT", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_usataxpymt(${old}) AS key`
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

  it("moves a person's tax tag, category, finding and stored names", async () => {
    const user = await client.user.create({
      data: { email: `merchant-irs-keys-${crypto.randomUUID()}@example.com` },
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
        dedupeKey: "irs-1",
        date: new Date("2026-10-12T00:00:00Z"),
        amountCents: 15_000,
        description: "Withdrawal to IRS USATAXPYMT",
        merchantName: "IRS Usataxpymt",
        pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "irs usataxpymt",
        source: "user",
        pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:irs usataxpymt",
        title: "Review your IRS Usataxpymt subscription",
        confidence: "medium",
        status: "declined",
      },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    expect(
      (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
    ).toBe("irs");
    expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
      key: "merchant:irs",
      status: "declined",
    });
    expect((await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName).toBe(
      "IRS",
    );
  });
});
