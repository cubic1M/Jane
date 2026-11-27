import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ enqueueJob: vi.fn(async () => "job_1") }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { scopedFor } from "@/lib/db-scoped";
import { importCsvFiles } from "./import-csv";
import { saveUpload } from "./upload";

// Pre-deploy walk of 11-27 (data loss): a second account's OFX file whose row ids (FITID) repeat
// the first's was refused as "already in" the first account, and following that message saved the
// rows whose id was not reused and dropped the rest. A bank's row id is an id only within its own
// account.
const url = process.env.TEST_DATABASE_URL;

const ofx = (acct: string, rows: [fitid: string, date: string, amount: string, name: string][]) =>
  [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
    "<OFX>",
    "<BANKMSGSRSV1>",
    "<STMTTRNRS>",
    "<STMTRS>",
    "<CURDEF>USD",
    "<BANKACCTFROM>",
    "<BANKID>000000000",
    `<ACCTID>${acct}`,
    "<ACCTTYPE>CHECKING",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    "<DTSTART>20261001",
    "<DTEND>20261031",
    ...rows.flatMap(([fitid, date, amount, name]) => [
      "<STMTTRN>",
      `<TRNTYPE>${Number(amount) < 0 ? "DEBIT" : "CREDIT"}`,
      `<DTPOSTED>${date}`,
      `<TRNAMT>${amount}`,
      `<FITID>${fitid}`,
      `<NAME>${name}`,
      "</STMTTRN>",
    ]),
    "</BANKTRANLIST>",
    "</STMTRS>",
    "</STMTTRNRS>",
    "</BANKMSGSRSV1>",
    "</OFX>",
  ].join("\n");

const FIRST = ofx("1111111111", [
  ["0001", "20261001", "-15.49", "NETFLIX.COM"],
  ["0002", "20261003", "2500.00", "ACME CORP PAYROLL"],
  ["0003", "20261004", "-42.10", "SAFEWAY"],
  ["0004", "20261005", "-9.99", "SPOTIFY USA"],
  ["0005", "20261006", "-61.00", "SHELL OIL"],
  ["0006", "20261007", "-120.00", "PG AND E"],
]);
// Another account at the same bank, ids numbered the same way, other rows.
const SECOND = ofx("2222222222", [
  ["0001", "20261008", "-88.00", "COSTCO WHOLESALE"],
  ["0002", "20261009", "1500.00", "TRANSFER FROM SAVINGS"],
  ["0003", "20261010", "-12.00", "BLUE BOTTLE"],
  ["0004", "20261011", "-30.00", "CHEVRON"],
  ["0005", "20261012", "-19.99", "HULU"],
  ["0006", "20261013", "-54.20", "TARGET"],
]);

describe.runIf(url)("two accounts whose OFX row ids overlap", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: "ofx-reused-ids@example.com" } })).id;
  });
  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  function form(fields: Record<string, string>, name: string, text: string) {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    data.append("files", new File([text], name, { type: "application/x-ofx" }));
    return data;
  }

  it("is a new account, with every row, not 'already in' the first", async () => {
    const db = scopedFor(userId, client);
    const first = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Checking one", "new.kind": "checking" },
        "one.ofx",
        FIRST,
      ),
    );
    if (!first.ok) throw new Error(first.error);
    const second = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Checking two", "new.kind": "checking" },
        "two.ofx",
        SECOND,
      ),
    );
    if (!second.ok) throw new Error(second.error);
    expect(second.accountId).not.toBe(first.accountId);
    expect(await client.transaction.count({ where: { accountId: second.accountId } })).toBe(6);
    expect(await client.transaction.count({ where: { accountId: first.accountId } })).toBe(6);
  });

  it("keeps every row when the second file is added to the first account anyway", async () => {
    const db = scopedFor(userId, client);
    const account = (
      await client.account.create({
        data: { userId, source: "csv", name: "Mixed", type: "depository", subtype: "checking" },
      })
    ).id;
    await importCsvFiles(db, account, [{ name: "one.ofx", text: FIRST }]);
    const result = await importCsvFiles(db, account, [{ name: "two.ofx", text: SECOND }]);
    expect(result.inserted).toBe(6);
    // The same file again is still the same rows.
    expect((await importCsvFiles(db, account, [{ name: "two.ofx", text: SECOND }])).inserted).toBe(
      0,
    );
    expect(await client.transaction.count({ where: { accountId: account } })).toBe(12);
  });

  // CodeRabbit on this PR: rows stored under the key a reused id gets must be recognised later.
  it("recognises rows kept under a reused id's own key, and keeps two files' rows in one upload", async () => {
    const other = await client.user.create({ data: { email: "ofx-reused-ids-2@example.com" } });
    try {
      const db = scopedFor(other.id, client);
      const account = (
        await client.account.create({
          data: {
            userId: other.id,
            source: "csv",
            name: "Together",
            type: "depository",
            subtype: "checking",
          },
        })
      ).id;
      // Two overlapping files of one upload, an id reused for different transactions.
      const both = await importCsvFiles(db, account, [
        { name: "one.ofx", text: FIRST },
        { name: "two.ofx", text: SECOND },
      ]);
      expect(both.inserted).toBe(12);
      // The first file's rows taken back; the second file again is still its own rows.
      await client.transaction.deleteMany({
        where: { accountId: account, dedupeKey: { not: { contains: "|" } } },
      });
      expect(
        (await importCsvFiles(db, account, [{ name: "two.ofx", text: SECOND }])).inserted,
      ).toBe(0);
      // And as a new account it is refused as already there, not made twice.
      const again = await saveUpload(
        db,
        form(
          { accountId: "new", "new.name": "Checking again", "new.kind": "checking" },
          "two.ofx",
          SECOND,
        ),
      );
      expect(again.ok).toBe(false);
      expect(!again.ok && again.error).toContain("already in Together");
    } finally {
      await client.user.deleteMany({ where: { id: other.id } });
    }
  });
});
