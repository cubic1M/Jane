import { describe, expect, it } from "vitest";
import { MAX_CELL_CHARS, parseCsv } from "@/data-sources/csv/parse-csv";
import { markerColumns } from "@/data-sources/csv/column-mapping";
import { CsvDataSource } from "@/data-sources/csv/csv-source";
import { readOfx } from "@/data-sources/ofx/parse-ofx";
import { normalizeMerchant } from "@/data-sources/merchant";
import { previewCsvFiles } from "./import-csv";

// Files shaped to make the reader slow or make it throw. Anyone can upload one from the landing
// page, so reading the largest allowed file must stay cheap whatever is in it. The bound is far
// over what these take (milliseconds) and far under what the bad shapes took (16 s for the first
// at 1 MB, minutes for the long spaces), so a busy test machine doesn't trip it.
const MB = 1024 * 1024;
const BOUND_MS = 8_000;
const fill = (unit: string, bytes: number) =>
  unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
const CHASE = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n";
const OFX = "OFXHEADER:100\n<OFX>\n";
const ONE_ROW = "<STMTTRN><DTPOSTED>20261001<TRNAMT>-1.00<FITID>1<NAME>SHOP</STMTTRN>";

// A row for each day, going back: no two on one date, for what looks at each day in turn.
function everyDayRows(bytes: number, balance = "1"): string {
  const rows: string[] = [];
  let size = 0;
  for (let day = 0; size < bytes; day += 1) {
    const at = new Date(Date.UTC(2026, 9, 14) - day * 86_400_000);
    const date = `${String(at.getUTCMonth() + 1).padStart(2, "0")}/${String(at.getUTCDate()).padStart(2, "0")}/${at.getUTCFullYear()}`;
    const row = `DEBIT,${date},"A",-1,D,${balance},,\n`;
    rows.push(row);
    size += row.length;
  }
  return rows.join("");
}

const SHAPES: [string, string, string][] = [
  ["opening transaction tags with no closing tag", "a.ofx", OFX + fill("<STMTTRN>", MB)],
  [
    "many tiny transactions, each on its own line",
    "a.ofx",
    OFX + fill("<STMTTRN></STMTTRN>\n", MB),
  ],
  ["opening balance tags with no end", "a.ofx", OFX + ONE_ROW + fill("<LEDGERBAL>", MB)],
  ["account tags and spaces", "a.ofx", OFX + fill("<ACCTID> ", MB)],
  ["spaces before anything", "a.txt", fill(" ", MB) + "x"],
  ["one very long line", "a.csv", fill("a", MB)],
  ["nothing but commas", "a.csv", fill(",", MB)],
  ["149,000 tiny rows", "a.csv", fill("a,b\n", MB)],
  ["an unclosed quote", "a.csv", `"${fill("a,", MB)}`],
  [
    "a long description of spaces",
    "a.csv",
    `${CHASE}DEBIT,10/14/2026,"X${fill(" ", MB - 200)}Y",-1.00,DEBIT_CARD,1.00,,\n`,
  ],
  [
    "a long description of digits",
    "a.csv",
    `${CHASE}DEBIT,10/14/2026,"${fill("1", MB - 200)}",-1.00,DEBIT_CARD,1.00,,\n`,
  ],
  [
    "a long description of processor prefixes",
    "a.csv",
    `${CHASE}DEBIT,10/14/2026,"${fill("SQ *", MB - 200)}",-1.00,DEBIT_CARD,1.00,,\n`,
  ],
  [
    "a real layout with far too many rows",
    "a.csv",
    CHASE + fill('DEBIT,10/14/2026,"A",-1,D,1,,\n', MB),
  ],
  ["a real layout with a different day on every row", "a.csv", CHASE + everyDayRows(MB)],
  ["a real layout with a running balance on every row", "a.csv", CHASE + everyDayRows(MB, "12.34")],
  ["transactions in an OFX file, as many as fit", "a.ofx", OFX + fill(ONE_ROW + "\n", MB)],
  ["a very wide file", "a.csv", `${fill("h,", MB / 2)}\n${fill("1,", MB / 2)}`],
];

describe("reading a file made to be slow", () => {
  it.each(SHAPES)("reads %s quickly, without throwing", (_name, file, text) => {
    const started = performance.now();
    expect(() => previewCsvFiles([{ name: file, text }])).not.toThrow();
    expect(performance.now() - started).toBeLessThan(BOUND_MS);
  });

  it("still reads a long description all the way through to a merchant", async () => {
    const text = `${CHASE}DEBIT,10/14/2026,"X${fill(" ", MB - 200)}Y",-1.00,DEBIT_CARD,1.00,,\n`;
    const started = performance.now();
    const batch = await new CsvDataSource(
      { ref: "n", name: "x", kind: "checking", mask: null, currentBalanceCents: null },
      [{ name: "a.csv", text }],
    ).load();
    for (const row of batch.transactions) normalizeMerchant(row.description);
    expect(performance.now() - started).toBeLessThan(BOUND_MS);
    expect(batch.transactions).toHaveLength(1);
  });
});

describe("a temporary try's reader", () => {
  it("stops at its limit before reading a row, in a CSV or an OFX file", () => {
    const limit = { rows: 3_000, words: "Too many." };
    for (const [file, text] of [
      ["a.csv", CHASE + fill('DEBIT,10/14/2026,"A",-1,D,1,,\n', MB)],
      ["a.ofx", OFX + fill(ONE_ROW + "\n", MB)],
    ] as const) {
      const started = performance.now();
      const [read] = previewCsvFiles([{ name: file, text }], undefined, limit);
      expect(read).toMatchObject({ ok: false, error: "Too many." });
      expect(performance.now() - started).toBeLessThan(BOUND_MS / 4);
    }
  });

  it("reads a file at its limit, header and summary lines included", () => {
    const rows = 'DEBIT,10/14/2026,"A",-1.00,DEBIT_CARD,1.00,,\n'.repeat(3_000);
    const [read] = previewCsvFiles([{ name: "a.csv", text: CHASE + rows }], undefined, {
      rows: 3_000,
      words: "Too many.",
    });
    expect(read).toMatchObject({ ok: true });
  });
});

describe("the fixes behind that", () => {
  it("stops at the first transaction with no closing tag, and keeps what came before", () => {
    const result = readOfx({ name: "a.ofx", text: `${OFX}${ONE_ROW}\n${fill("<STMTTRN>", MB)}` });
    expect(result).toMatchObject({ ok: true, transactions: [{ externalId: "ofx:1" }] });
  });

  it("gets the tags right in any case, and says which line a bad transaction is on", () => {
    const text = `${OFX}\n\n<stmttrn><TRNAMT>-1.00</StmtTrn>\n${ONE_ROW}`;
    const result = readOfx({ name: "a.ofx", text });
    expect(result).toMatchObject({
      ok: true,
      transactions: [{ externalId: "ofx:1" }],
      skipped: [{ line: 5, reason: expect.stringMatching(/date/) }],
    });
  });

  it("keeps offsets right past a letter that changes length in lower case", () => {
    const text = `${OFX}<STMTTRN><DTPOSTED>20261001<TRNAMT>-1.00<FITID>1<NAME>İİİ SHOP</STMTTRN>`;
    expect(readOfx({ name: "a.ofx", text })).toMatchObject({
      ok: true,
      transactions: [{ amountCents: 100, externalId: "ofx:1" }],
    });
  });

  it("reads the balance from the first balance tag to whatever ends it", () => {
    const text = `${OFX}${ONE_ROW}<LEDGERBAL><BALAMT>12.50<DTASOF>20261001<AVAILBAL><BALAMT>9.00</OFX>`;
    expect(readOfx({ name: "a.ofx", text })).toMatchObject({
      balances: [{ date: "2026-10-01", balanceCents: 1250 }],
    });
  });

  it("cuts a field far past any bank's, in a CSV or an OFX file", () => {
    const [record] = parseCsv(`${fill("a", MAX_CELL_CHARS + 50)},b\n`);
    expect(record.fields[0]).toHaveLength(MAX_CELL_CHARS);
    expect(record.fields[1]).toBe("b");
    const long = `${OFX}<STMTTRN><DTPOSTED>20261001<TRNAMT>-1.00<FITID>1<NAME>${fill("a", MB / 4)}</STMTTRN>`;
    const result = readOfx({ name: "a.ofx", text: long });
    expect(result.ok && result.transactions[0].description.length).toBe(MAX_CELL_CHARS);
  });

  it("says a very wide file has too many columns", () => {
    const [read] = previewCsvFiles([{ name: "a.csv", text: `${fill("h,", 2000)}\n` }]);
    expect(read).toMatchObject({ ok: false, error: expect.stringMatching(/too many columns/) });
  });

  it("works out markers from more rows than a call can take as arguments", () => {
    const rows = Array.from({ length: 200_000 }, () => ["a"]);
    expect(() => markerColumns(["h"], rows)).not.toThrow();
  });
});
