import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { importCsvFiles } from "./import-csv";
import { scopedFor } from "@/lib/db-scoped";

// One account's statement as a CSV and then as QFX, against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts): the second adds only what's new.
const url = process.env.TEST_DATABASE_URL;

const csv = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "DEBIT,10/02/2026,NETFLIX.COM 866-579-7172 CA RECURRING PAYMENT,-15.49,ACH_DEBIT,2484.51,,",
  "CREDIT,10/01/2026,INITECH PAYROLL PPD ID 12345,2500.00,ACH_CREDIT,2500.00,,",
].join("\n");

// The same two (names cut at 32 letters, one posted a day later) and one newer.
const qfx = (rows: [string, string, string, string][]) =>
  "OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>4321<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST>" +
  rows
    .map(
      ([id, day, amount, name]) =>
        `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${day}<TRNAMT>${amount}<FITID>${id}<NAME>${name}</STMTTRN>`,
    )
    .join("") +
  "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

describe.runIf(url)("a statement as CSV and then as QFX, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `twins-${crypto.randomUUID()}@example.com` } })
    ).id;
    accountId = (
      await client.account.create({
        data: {
          userId,
          source: "csv",
          name: "Chase checking",
          type: "depository",
          subtype: "checking",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("adds only the rows the CSV didn't have", async () => {
    const db = scopedFor(userId, client);
    const first = await importCsvFiles(db, accountId, [{ name: "Chase.CSV", text: csv }]);
    expect(first.inserted).toBe(2);

    const second = await importCsvFiles(db, accountId, [
      {
        name: "Chase.QFX",
        text: qfx([
          ["A1", "20261002", "-15.49", "NETFLIX.COM 866-579-7172 CA RECU"],
          ["A2", "20261002", "2500.00", "INITECH PAYROLL PPD ID 12345"],
          ["A3", "20261014", "-15.49", "NETFLIX.COM 866-579-7172 CA RECU"],
        ]),
      },
    ]);
    expect(second).toMatchObject({ inserted: 1, duplicates: 2 });
    const rows = await client.transaction.findMany({
      where: { accountId },
      orderBy: { date: "asc" },
    });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.amountCents])).toEqual([
      // Money in is negative, as everywhere.
      ["2026-10-01", -250000],
      ["2026-10-02", 1549],
      ["2026-10-14", 1549],
    ]);

    // And the other way round: the CSV again after the QFX adds nothing either.
    const third = await importCsvFiles(db, accountId, [{ name: "Chase (1).CSV", text: csv }]);
    expect(third.inserted).toBe(0);
  });
});
