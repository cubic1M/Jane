import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys stop at the company on an ACH line (the metamorphic suite), and the
// migration moves saved rows to the new key and name: the SQL must give each old key the key
// normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270505000000_merchant_without_ach_details/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  [
    "ORIG CO NAME:USAA P&C ORIG ID:1234567890 DESC DATE:260908 CO ENTRY DESCR:AUTOPAY SEC:PPD TRACE#:021000020000001 EED:260908 IND ID:12345678 IND NAME:RAJ MEHTA",
    "usaa p&c orig id desc date co entry descr autopay sec ppd trace eed ind id ind name raj mehta",
  ],
  ["STATE FARM INSURANCE BILL PAY", "state farm insurance bill pay"],
  ["PROGRESSIVE INS BILLPAY", "progressive ins billpay"],
  ["USAA P&C AUTOPAY", "usaa p&c autopay"],
  ["ROOT INSURANCE WEB PMT", "root insurance web pmt"],
  ["TRAVELERS INS ONLINE PMT", "travelers ins online pmt"],
  ["CHASE AUTOPAY", "chase autopay"],
  ["BILL PAY", "bill pay"],
  ["AT&T BILL PAYMENT", "at&t bill payment"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)(
  "the migration to merchant keys that stop at the company on an ACH line",
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const sqlKey = async (old: string) =>
      (
        await client.$queryRaw<
          { key: string }[]
        >`SELECT jane_merchant_key_without_ach_details(${old}) AS key`
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
        data: { email: `merchant-ach-details-keys-${crypto.randomUUID()}@example.com` },
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
          dedupeKey: "ach-details-1",
          date: new Date("2026-10-01T00:00:00Z"),
          amountCents: 214_000,
          description: "STATE FARM INSURANCE BILL PAY",
          merchantName: "State Farm Insurance Bill Pay",
          pfcPrimary: "GENERAL_SERVICES",
          pfcDetailed: "GENERAL_SERVICES_INSURANCE",
        },
      });
      await client.merchantCategory.create({
        data: {
          userId: user.id,
          merchantKey: "state farm insurance bill pay",
          source: "user",
          pfcPrimary: "GENERAL_SERVICES",
          pfcDetailed: "GENERAL_SERVICES_INSURANCE",
        },
      });
      await client.finding.create({
        data: {
          userId: user.id,
          type: "subscription_review",
          key: "merchant:state farm insurance bill pay",
          title: "Review your State Farm Insurance Bill Pay subscription",
          confidence: "medium",
          status: "declined",
        },
      });

      for (const sql of updates) await client.$executeRawUnsafe(sql);
      // Again, as a second deploy would: nothing more moves.
      for (const sql of updates) await client.$executeRawUnsafe(sql);

      expect(
        (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
      ).toBe("state farm insurance");
      expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
        key: "merchant:state farm insurance",
        status: "declined",
      });
      expect(
        (await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName,
      ).toBe("State Farm Insurance");
    });
  },
);
