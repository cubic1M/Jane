import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop "POS DEBIT" (Truist, KeyBank, Navy Federal) and a trailing "ACH DEBIT"
// (debugger 11-14), and
// the migration moves saved rows to the new key and name: the SQL must give each old key the key
// normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270517000000_merchant_without_pos_debit/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["POS DEBIT NETFLIX.COM 866-579-7172 CA", "debit netflix"],
  ["POS DEBIT- DEBIT CARD 1234 03-15-26 NETFLIX.COM 866-579-7172 CA", "debit- debit card netflix"],
  ["POS DEBIT KROGER #0451 AUSTIN TX", "debit kroger"],
  ["VERIZON WIRELESS PAYMENTS ACH DEBIT", "verizon wireless payments ach debit"],
  ["NETFLIX.COM", "netflix"],
  ["ACME ACH DEBIT SERVICES", "acme ach debit services"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)(
  "the migration to merchant keys without POS DEBIT and a trailing ACH DEBIT",
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const sqlKey = async (old: string) =>
      (
        await client.$queryRaw<
          { key: string }[]
        >`SELECT jane_merchant_key_without_pos_debit(${old}) AS key`
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
        data: { email: `merchant-pos-debit-keys-${crypto.randomUUID()}@example.com` },
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
          dedupeKey: "posdebit-1",
          date: new Date("2026-10-01T00:00:00Z"),
          amountCents: 1_549,
          description: "POS DEBIT NETFLIX.COM 866-579-7172 CA",
          merchantName: "Debit Netflix",
          pfcPrimary: "ENTERTAINMENT",
          pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        },
      });
      await client.merchantCategory.create({
        data: {
          userId: user.id,
          merchantKey: "debit netflix",
          source: "user",
          pfcPrimary: "ENTERTAINMENT",
          pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        },
      });
      await client.finding.create({
        data: {
          userId: user.id,
          type: "subscription_review",
          key: "merchant:debit netflix",
          title: "Review your Debit Netflix subscription",
          confidence: "medium",
          status: "declined",
        },
      });

      for (const sql of updates) await client.$executeRawUnsafe(sql);
      // Again, as a second deploy would: nothing more moves.
      for (const sql of updates) await client.$executeRawUnsafe(sql);

      expect(
        (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
      ).toBe("netflix");
      expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
        key: "merchant:netflix",
        status: "declined",
      });
      expect(
        (await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName,
      ).toBe("Netflix");
    });
  },
);
