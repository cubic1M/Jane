import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { normalizeMerchant } from "./merchant";

// Merchant names and keys drop an ACH line's own code at the end (debug 2, 11-19: rent read "Avalon
// Bay Rent Ach Web" in a student's bills), and the migration moves saved rows to the new key and
// name: the SQL must give each old key the key normalizeMerchant gives now, and a finding the person
// said no to must still be the one detection names. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270520000000_merchant_without_ach_tail/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["AVALON BAY RENT ACH WEB", "avalon bay rent ach web"],
  ["CITY OF PALO ALTO UTIL ACH PPD", "city of palo alto util ach ppd"],
  ["STATE FARM INSURANCE ACH", "state farm insurance ach"],
  ["VERIZON WIRELESS PAYMENTS", "verizon wireless payments"],
  ["NETFLIX.COM", "netflix"],
];

const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without an ACH line's code", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_ach_tail(${old}) AS key`
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

  it("moves a person's category, a finding they said no to and stored names, once", async () => {
    const user = await client.user.create({
      data: { email: `merchant-ach-tail-keys-${crypto.randomUUID()}@example.com` },
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
        amountCents: 140_000,
        description: "AVALON BAY RENT ACH WEB",
        merchantName: "Avalon Bay Rent Ach Web",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "avalon bay rent ach web",
        source: "user",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      },
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: "merchant:avalon bay rent ach web",
        title: "Review Avalon Bay Rent Ach Web",
        confidence: "medium",
        status: "declined",
      },
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    const now = normalizeMerchant("AVALON BAY RENT ACH WEB")!;
    expect(
      (await client.merchantCategory.findFirst({ where: { userId: user.id } }))?.merchantKey,
    ).toBe(now.key);
    // The "no" stays on the finding detection names now, so it isn't offered again.
    expect(await client.finding.findFirst({ where: { userId: user.id } })).toMatchObject({
      key: `merchant:${now.key}`,
      status: "declined",
    });
    expect((await client.transaction.findFirst({ where: { userId: user.id } }))?.merchantName).toBe(
      now.name,
    );
  });
});
