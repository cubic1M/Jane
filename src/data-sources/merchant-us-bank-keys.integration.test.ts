import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop U.S. Bank's words in front (debugger 11-06), and
// the migration moves saved rows to the new key and name: the SQL must give each old key the key
// normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270511000000_merchant_without_us_bank_prefix/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["WEB AUTHORIZED PMT TOYOTA FINANCIAL", "web authorized pmt toyota financial"],
  ["ELECTRONIC DEPOSIT ST LUKES HEALTH", "electronic deposit st lukes health"],
  ["DEBIT PURCHASE -VISA NETFLIX.COM 866-579-7172 CA", "debit purchase -visa netflix"],
  ["RECURRING DEBIT PURCHASE PLANET FITNESS", "debit purchase planet fitness"],
  ["DEBIT PURCHASE KING SOOPERS #0123 DENVER CO", "debit purchase king soopers"],
  ["DEBIT PURCHASE", "debit purchase"],
  ["ELECTRONIC DEPOSIT", "electronic deposit"],
  ["ACME DEBIT PURCHASE SERVICES", "acme debit purchase services"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without U.S. Bank's words in front", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_us_bank_prefix(${old}) AS key`
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
      data: { email: `merchant-us-bank-keys-${crypto.randomUUID()}@example.com` },
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
        dedupeKey: "usbank-1",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: 214_000,
        description: "WEB AUTHORIZED PMT TOYOTA FINANCIAL",
        merchantName: "Web Authorized Pmt Toyota Financial",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CAR_PAYMENT",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "web authorized pmt toyota financial",
        source: "user",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CAR_PAYMENT",
      },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:web authorized pmt toyota financial",
        title: "Review your Web Authorized Pmt Toyota Financial subscription",
        confidence: "medium",
        status: "declined",
      },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    expect(
      (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
    ).toBe("toyota financial");
    expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
      key: "merchant:toyota financial",
      status: "declined",
    });
    expect((await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName).toBe(
      "Toyota Financial",
    );
  });
});
