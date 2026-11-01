import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { CARD_CITIES, normalizeMerchant } from "./merchant";

// Merchant keys drop the card's city (debugger 11-01: "Review your Doordash Dashpass San
// Francisco subscription"), and the migration moves saved rows to the new key: the SQL must give
// each old key the key normalizeMerchant gives now. Runs against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

const MIGRATION = "prisma/migrations/20270419000000_merchant_without_card_city/migration.sql";

// Each description with the key it had before the change, written out by hand.
const OLD_KEYS: [string, string][] = [
  ["DOORDASH DASHPASS SAN FRANCISCO CA", "doordash dashpass san francisco"],
  ["PELOTON APP MEMBERSHIP NEW YORK NY", "peloton app membership new york"],
  ["NETFLIX.COM LOS GATOS CA", "netflix los gatos"],
  ["SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA", "blue bottle coffee oakland"],
  ["Doordash Dashpass San Francisco", "doordash dashpass san francisco"],
  ["UNIVERSITY OF CHICAGO", "university of chicago"],
  ["CITY OF SAN JOSE", "city of san jose"],
  ["SEATTLE CA", "seattle"],
  ["ZELLE FROM CHICAGO", "from chicago"],
  ["NEW YORK TIMES DIGITAL", "new york times digital"],
  ["SPOTIFY P1A2B3C4D5 EVANSTON IL", "spotify evanston"],
];

// The migration's UPDATE statements, run again on rows made here.
const updates = readFileSync(MIGRATION, "utf8")
  .split("$$;")
  .at(-1)!
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter((s) => s.startsWith("UPDATE"));

describe.runIf(url)("the migration to merchant keys without the card's city", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sqlKey = async (old: string) =>
    (
      await client.$queryRaw<
        { key: string }[]
      >`SELECT jane_merchant_key_without_city(${old}) AS key`
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

  it("knows every city the code drops", async () => {
    for (const city of CARD_CITIES) {
      const description = `ACME CLUB ${city}`;
      expect(await sqlKey(description.toLowerCase())).toBe(normalizeMerchant(description)?.key);
    }
  });

  it("moves a person's category and findings, keeping the decision on the finding", async () => {
    const user = await client.user.create({
      data: { email: `merchant-city-keys-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.merchantCategory.create({
      data: {
        userId: user.id,
        merchantKey: "doordash dashpass san francisco",
        source: "user",
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_RESTAURANT",
      },
    });
    const finding = (key: string) => ({
      userId: user.id,
      type: "subscription_review" as const,
      key,
      title: "Review your subscription",
      confidence: "medium" as const,
      status: "declined" as const,
    });
    await client.finding.createMany({
      data: [
        finding("merchant:doordash dashpass san francisco"),
        finding("merchant:peloton app membership new york@yearly"),
        finding("merchant:hulu"),
      ],
    });

    for (const sql of updates) await client.$executeRawUnsafe(sql);
    // Again, as a second deploy would: nothing more moves.
    for (const sql of updates) await client.$executeRawUnsafe(sql);

    const category = await client.merchantCategory.findFirst({ where: { userId: user.id } });
    expect(category?.merchantKey).toBe("doordash dashpass");
    const findings = await client.finding.findMany({
      where: { userId: user.id },
      select: { key: true, status: true },
      orderBy: { key: "asc" },
    });
    expect(findings).toEqual([
      { key: "merchant:doordash dashpass", status: "declined" },
      { key: "merchant:hulu", status: "declined" },
      { key: "merchant:peloton app membership@yearly", status: "declined" },
    ]);
  });
});
