import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names drop the payment app (overnight beta list), and the migration moves saved
// rows to the new key: the SQL must give each old key the key normalizeMerchant gives now.
// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270414000000_merchant_without_payment_app/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["Zelle To Oak Ridge Apts Rent", "zelle to oak ridge apts rent"],
  ["ZELLE PAYMENT TO OAK RIDGE APTS JPM99ABC1234", "zelle payment to oak ridge apts"],
  [
    'Zelle payment to OAK RIDGE for "Rent"; Conf# abc123',
    "zelle payment to oak ridge for rent conf",
  ],
  ["ZELLE TO SMITH JOHN ON 10/03 REF # WFCT0ABC", "zelle to smith john on ref wfct0abc"],
  ["Zelle money sent to LANDLORD LLC", "zelle money sent to landlord llc"],
  ["Zelle money received from Sam Rivera", "zelle money received from sam rivera"],
  ["ZELLE FROM MOM", "zelle from mom"],
  ["VENMO PAYMENT TO JORDAN LEE", "venmo payment to jordan lee"],
  ["CASHAPP TO ALEX", "cashapp to alex"],
  ["Apple Cash Sent To Kim Payment", "apple cash sent to kim payment"],
  ["VENMO PAYMENT 1234567890 WEB ID: 3264681992", "venmo payment"],
  ["Zelle To Rent", "zelle to rent"],
  ["NETFLIX.COM", "netflix"],
];

// The migration's UPDATE statements, run again on rows made here.
const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")[1]
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without the payment app", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it.each(OLD_KEYS)("gives %s's old key the key it has now", async (description, old) => {
    const [row] = await client.$queryRaw<{ key: string }[]>`
      SELECT jane_merchant_key_without_app(${old}) AS key`;
    expect(row.key).toBe(normalizeMerchant(description)?.key);
  });

  it("moves a person's saved category, keeping their own where two old keys meet", async () => {
    const user = await client.user.create({
      data: { email: `merchant-keys-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const category = (merchantKey: string, source: "user" | "llm", pfcDetailed: string) => ({
      userId: user.id,
      merchantKey,
      source,
      pfcPrimary: pfcDetailed.split("_")[0],
      pfcDetailed,
    });
    await client.merchantCategory.createMany({
      data: [
        category("zelle to oak ridge apts rent", "user", "RENT_AND_UTILITIES_RENT"),
        category("zelle payment to oak ridge apts", "llm", "TRANSFER_OUT_ACCOUNT_TRANSFER"),
        category("zelle from mom", "user", "INCOME_OTHER_INCOME"),
        category("netflix", "user", "ENTERTAINMENT_TV_AND_MOVIES"),
      ],
    });
    await client.taxTag.create({
      data: { userId: user.id, merchantKey: "venmo payment to jordan lee", tag: "business" },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    const rows = await client.merchantCategory.findMany({
      where: { userId: user.id },
      select: { merchantKey: true, pfcDetailed: true },
      orderBy: { merchantKey: "asc" },
    });
    expect(rows).toEqual([
      { merchantKey: "from mom", pfcDetailed: "INCOME_OTHER_INCOME" },
      { merchantKey: "netflix", pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES" },
      { merchantKey: "oak ridge apts", pfcDetailed: "RENT_AND_UTILITIES_RENT" },
      // The machine's guess stays on the old key, where nothing reads it.
      {
        merchantKey: "zelle payment to oak ridge apts",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      },
    ]);
    const tags = await client.taxTag.findMany({ where: { userId: user.id } });
    expect(tags.map((t) => t.merchantKey)).toEqual(["jordan lee"]);
  });
});
