import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { scopedFor } from "@/lib/db-scoped";
import { importCsvFiles } from "./import-csv";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const fixture = (name: string) => ({
  name,
  text: readFileSync(
    new URL(`../../data-sources/ofx/__fixtures__/${name}`, import.meta.url),
    "utf8",
  ),
});

describe.runIf(url)("importing OFX and QFX against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `ofx-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  async function account(name: string, type: string, subtype: string) {
    return (await client.account.create({ data: { userId, source: "csv", name, type, subtype } }))
      .id;
  }

  it("imports both dialects, and re-importing the same file adds nothing", async () => {
    const db = scopedFor(userId, client);
    const checking = await account("Checking", "depository", "checking");
    const card = await account("Card", "credit", "credit card");

    expect(await importCsvFiles(db, checking, [fixture("checking-sgml.ofx")])).toEqual({
      parsed: 3,
      inserted: 3,
      duplicates: 0,
      skipped: 1,
      files: [{ format: "ofx", rows: 3 }],
      // The statement's <LEDGERBAL>, kept for net worth over time.
      balances: [{ date: "2026-10-15", balanceCents: 123456 }],
      from: expect.any(String),
      to: expect.any(String),
    });
    expect(await importCsvFiles(db, card, [fixture("card-xml.qfx")])).toMatchObject({
      inserted: 2,
    });

    expect(await importCsvFiles(db, checking, [fixture("checking-sgml.ofx")])).toMatchObject({
      inserted: 0,
      duplicates: 3,
    });
    const rows = await client.transaction.findMany({
      where: { userId },
      orderBy: { date: "asc" },
      select: { accountId: true, amountCents: true, dedupeKey: true },
    });
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.accountId === checking).map((r) => r.amountCents)).toEqual([
      1549, -250_000, 3500,
    ]);
  });
});
