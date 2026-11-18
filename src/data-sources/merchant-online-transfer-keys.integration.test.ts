import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop Wells Fargo's "ONLINE TRANSFER TO … REF #…" around a payee (debugger
// 11-17: rent read "Online Transfer To Oakwood Residential Ref"), and the migration moves saved rows
// to the new key and name: the SQL must give each old key the key normalizeMerchant gives now. Runs
// against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270518000000_merchant_without_online_transfer/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  [
    "ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9",
    "online transfer to oakwood residential ref",
  ],
  [
    "ONLINE TRANSFER TO SMITH J EVERYDAY CHECKING XXXXXX1234 REF #IBE7KQ2VWX ON 11/01/26",
    "online transfer to smith j everyday checking ref on",
  ],
  ["ONLINE TRANSFER TO SAVINGS", "online transfer to savings"],
  ["ONLINE TRANSFER TO ALLY BANK SAVINGS", "online transfer to ally bank savings"],
  ["NETFLIX.COM", "netflix"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without Wells Fargo's transfer words", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_online_transfer(${old}) AS key`
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
      data: { email: `merchant-online-transfer-keys-${crypto.randomUUID()}@example.com` },
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
        dedupeKey: "rent-1",
        date: new Date("2026-11-01T00:00:00Z"),
        amountCents: 165_000,
        description: "ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9",
        merchantName: "Online Transfer To Oakwood Residential Ref",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "online transfer to oakwood residential ref",
        source: "user",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:online transfer to oakwood residential ref",
        title: "Review Online Transfer To Oakwood Residential Ref",
        confidence: "medium",
        status: "declined",
      },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    expect(
      (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
    ).toBe("oakwood residential");
    expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
      key: "merchant:oakwood residential",
      status: "declined",
    });
    expect((await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName).toBe(
      "Oakwood Residential",
    );
  });
});
