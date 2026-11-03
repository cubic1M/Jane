import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop a withdrawal's words in front (debugger 11-03: "Ach Withdrawal Rocket
// Mortgage Payment" on Bills), and the migration moves saved rows to the new key and name: the SQL
// must give each old key the key normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270502000000_merchant_without_ach_withdrawal/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["ACH WITHDRAWAL ROCKET MORTGAGE PAYMENT", "ach withdrawal rocket mortgage payment"],
  ["ACH PAYMENT STATE FARM INS", "ach payment state farm ins"],
  ["ACH PMT COMCAST", "ach pmt comcast"],
  ["ELECTRONIC WITHDRAWAL PUGET SOUND ENERGY", "electronic withdrawal puget sound energy"],
  ["EXTERNAL WITHDRAWAL ZIPCAR", "external withdrawal zipcar"],
  ["EFT WITHDRAWAL T-MOBILE", "eft withdrawal t-mobile"],
  ["PREAUTHORIZED DEBIT GEICO", "preauthorized debit geico"],
  ["PRE-AUTH DEBIT GEICO", "pre-auth debit geico"],
  ["ACH WITHDRAWAL", "ach withdrawal"],
  ["ACME ACH WITHDRAWAL SERVICES", "acme ach withdrawal services"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without a withdrawal's words", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_withdrawal(${old}) AS key`
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
      data: { email: `merchant-withdrawal-keys-${crypto.randomUUID()}@example.com` },
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
        dedupeKey: "ach-1",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: 214_000,
        description: "ACH WITHDRAWAL ROCKET MORTGAGE PAYMENT",
        merchantName: "Ach Withdrawal Rocket Mortgage Payment",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "ach withdrawal rocket mortgage payment",
        source: "user",
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
      },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:ach withdrawal rocket mortgage payment",
        title: "Review your Ach Withdrawal Rocket Mortgage Payment subscription",
        confidence: "medium",
        status: "declined",
      },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    expect(
      (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
    ).toBe("rocket mortgage payment");
    expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
      key: "merchant:rocket mortgage payment",
      status: "declined",
    });
    expect((await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName).toBe(
      "Rocket Mortgage Payment",
    );
  });
});
