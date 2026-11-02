import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop a statement's words in front (debugger 11-02), and the migration
// moves saved rows to the new key and name: the SQL must give each old key the key
// normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION =
  "prisma/migrations/20270422000000_merchant_without_statement_prefix/migration.sql";

// Each description with the key it had before the change: the old keys were read from a walk's
// stored rows, not worked out.
const OLD_KEYS: [string, string, string][] = [
  ["DEBIT CARD PURCHASE, AUT 100526 NETFLIX.COM LOS GATOS CA", "purchase aut netflix", "netflix"],
  [
    "DEBIT POS, AUT 102126 DDA PURCHASE SHOPRITE MARLTON NJ",
    "debit pos aut dda purchase shoprite marlton",
    "shoprite marlton",
  ],
  [
    "DEBIT CARD PURCHASE, AUT 101926 VISA DDA PUR GOOD DOG BAR PHILADELPHIA PA",
    "purchase aut visa dda pur good dog bar",
    "good dog bar",
  ],
  ["DEBIT CARD CREDIT, AUT 102226 AMAZON.COM REFUND", "credit aut amazon refund", "amazon refund"],
  [
    "ELECTRONIC PMT-WEB, GEICO AUTO PAYMENT",
    "electronic pmt-web geico auto payment",
    "geico auto payment",
  ],
  [
    "ACH DEPOSIT, BRIGHTLINE INC PAYROLL",
    "ach deposit brightline inc payroll",
    "brightline inc payroll",
  ],
  ["ACH WEB DUQUESNE LIGHT", "ach web duquesne light", "duquesne light"],
  ["WEB PAYMENT GEICO", "web payment geico", "geico"],
  ["DIRECT DEP BRIGHTLINE INC", "direct dep brightline inc", "brightline inc"],
  ["Direct Deposit From BRIGHTLINE INC", "direct deposit from brightline inc", "brightline inc"],
];

// Left as they are: nothing follows the words, or they aren't in front.
const UNMOVED: string[] = [
  "direct deposit",
  "web payment",
  "acme direct dep",
  "purchase",
  "ach web",
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe("merchant names without a statement's words in front", () => {
  it.each(OLD_KEYS)("%s", (description, _old, key) => {
    expect(normalizeMerchant(description)?.key).toBe(key);
  });
});

describe.runIf(url)("the migration to merchant keys without a statement's words", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_prefix(${old}) AS key`
    )[0].key;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it.each(OLD_KEYS)("moves %s's old key", async (description, old) => {
    expect(await sqlKey(old)).toBe(normalizeMerchant(description)?.key);
  });

  it.each(UNMOVED)("leaves %s", async (old) => {
    expect(await sqlKey(old)).toBe(old);
  });

  it("moves a person's category, finding and stored names, and keeps their own", async () => {
    const user = await client.user.create({
      data: { email: `merchant-prefix-keys-${crypto.randomUUID()}@example.com` },
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
        dedupeKey: "prefix-1",
        date: new Date("2026-10-01T00:00:00Z"),
        amountCents: 1_549,
        description: "DEBIT CARD PURCHASE, AUT 100526 NETFLIX.COM LOS GATOS CA",
        merchantName: "Purchase Aut Netflix",
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "purchase aut netflix",
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        source: "user",
      },
    });
    for (const update of updates) await client.$executeRawUnsafe(update);
    const row = await client.transaction.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.merchantName).toBe("Netflix");
    const category = await client.merchantCategory.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(category.merchantKey).toBe("netflix");
    expect(category.source).toBe("user");
  });
});
