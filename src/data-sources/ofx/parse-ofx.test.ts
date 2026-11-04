import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeOfx, readOfx } from "./parse-ofx";

const fixture = (name: string) => ({
  name,
  text: readFileSync(join(__dirname, "__fixtures__", name), "utf8"),
});

describe("readOfx", () => {
  it("keeps the statement's closing balance, with a card's turned into what's owed", () => {
    const checking = readOfx(fixture("checking-sgml.ofx"));
    const card = readOfx(fixture("card-xml.qfx"));
    expect(checking.ok && checking.balances).toEqual([
      { date: "2026-10-15", balanceCents: 123456 },
    ]);
    expect(card.ok && card.balances).toEqual([{ date: "2026-10-15", balanceCents: 21045 }]);
  });

  it("reads an OFX 1.x (SGML) checking statement", () => {
    const result = readOfx(fixture("checking-sgml.ofx"));
    if (!result.ok) throw new Error(result.error);

    expect(result.transactions).toEqual([
      expect.objectContaining({
        date: "2026-10-01",
        amountCents: 1549,
        description: "NETFLIX.COM Recurring payment",
        merchantName: "Netflix",
        externalId: "ofx:202610010001",
        hints: { bankType: "DEBIT" },
      }),
      expect.objectContaining({
        date: "2026-10-03",
        amountCents: -250_000,
        externalId: "ofx:202610030002",
      }),
      expect.objectContaining({
        date: "2026-10-04",
        amountCents: 3500,
        description: "OVERDRAFT FEE",
      }),
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "Missing or unreadable date (DTPOSTED)" }),
    ]);
  });

  it("reads an OFX 2.x (XML) card statement, decoding entities", () => {
    const result = readOfx(fixture("card-xml.qfx"));
    if (!result.ok) throw new Error(result.error);
    expect(
      result.transactions.map((t) => [t.date, t.amountCents, t.description, t.externalId]),
    ).toEqual([
      ["2026-10-02", 4999, "GADGET SHOP & CO", "ofx:2026100200A1"],
      ["2026-10-08", -12_000, "PAYMENT THANK YOU", "ofx:2026100800B2"],
    ]);
  });

  it("refuses files that aren't OFX", () => {
    expect(readOfx({ name: "x.ofx", text: "Date,Amount\n" })).toMatchObject({ ok: false });
    expect(readOfx({ name: "x.ofx", text: "<OFX></OFX>" })).toMatchObject({
      ok: false,
      error: "The file has no transactions.",
    });
  });

  it("recognizes OFX by name or by its header", () => {
    expect(looksLikeOfx("statement.QFX", "")).toBe(true);
    expect(looksLikeOfx("download", "OFXHEADER:100\nDATA:OFXSGML")).toBe(true);
    expect(looksLikeOfx("download", '<?xml version="1.0"?>\n<?OFX OFXHEADER="200"?>')).toBe(true);
    expect(looksLikeOfx("export.csv", "Date,Amount")).toBe(false);
  });

  // Local build: 200 KB of unclosed tags took 2 seconds, and it grows with the square of the size.
  it("reads 4 MB of unclosed tags without slowing down", () => {
    const started = performance.now();
    for (const tag of ["<STMTTRN>", "<LEDGERBAL>"]) {
      readOfx({ name: "x.ofx", text: `<OFX>${tag.repeat(450_000)}` });
    }
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("keeps the line a skipped transaction started on", () => {
    const text = "<OFX>\n\n<STMTTRN>\n<NAME>A\n</STMTTRN>\n<STMTTRN>\n<NAME>B\n</STMTTRN>\n";
    const result = readOfx({ name: "x.ofx", text });
    expect(result.ok && result.skipped.map((s) => s.line)).toEqual([3, 6]);
  });

  // An independent read: <MEMO> had no limit, and a quadratic pattern reads the description later
  // (80 KB of spaces took 2.3 seconds in withoutAchDetails).
  it("bounds what it reads from a field, so later patterns can't be made slow", () => {
    const row = (memo: string) =>
      `<STMTTRN><DTPOSTED>20260101<TRNAMT>-1.00<FITID>a<NAME>Shop<MEMO>${memo}\n</STMTTRN>`;
    const result = readOfx({ name: "x.ofx", text: `<OFX>${row(`A${" ".repeat(80_000)}1`)}` });
    if (!result.ok) throw new Error(result.error);
    expect(result.transactions[0].description.length).toBeLessThan(50);
  });

  // The metamorphic suite: a bank that cuts NAME at 32 and puts the whole line in MEMO read as a
  // merchant cut mid-word, and the line said twice.
  // Debugger 11-04: a credit union's one file with checking and savings read as one account: 187
  // rows in checking, savings' balance lost, and no word of it.
  describe("a file with more than one account", () => {
    const statement = (acct: string, from = "BANKACCTFROM", fitid = acct) => `<STMTTRNRS><STMTRS>
<${from}><BANKID>253177049<ACCTID>${acct}<ACCTTYPE>CHECKING</${from}>
<BANKTRANLIST><STMTTRN><TRNTYPE>POS<DTPOSTED>20261001<TRNAMT>-5.00<FITID>${fitid}<NAME>SHOP
</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS>`;

    it("says so and adds nothing, without naming either account", () => {
      const result = readOfx({
        name: "cu.ofx",
        text: `<OFX>${statement("00077123451")}${statement("00077123452")}</OFX>`,
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(/holds 2 accounts/);
      expect(!result.ok && result.error).not.toContain("0007712345");
    });

    it("counts a card beside a bank account", () => {
      const result = readOfx({
        name: "cu.ofx",
        text: `<OFX>${statement("111")}${statement("222", "CCACCTFROM")}</OFX>`,
      });
      expect(!result.ok && result.error).toMatch(/holds 2 accounts/);
    });

    it("reads one account split over two statements", () => {
      const result = readOfx({
        name: "cu.ofx",
        text: `<OFX>${statement("111", "BANKACCTFROM", "a")}${statement("111", "BANKACCTFROM", "b")}</OFX>`,
      });
      expect(result.ok && result.transactions).toHaveLength(2);
    });

    it("doesn't count where a transfer went as an account in the file", () => {
      const text = `<OFX><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>1<ACCTID>111<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>XFER<DTPOSTED>20261001<TRNAMT>-5.00<FITID>a<NAME>TO SAVINGS
<BANKACCTTO><BANKID>1<ACCTID>222<ACCTTYPE>SAVINGS</BANKACCTTO></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></OFX>`;
      expect(readOfx({ name: "cu.ofx", text }).ok).toBe(true);
    });
  });

  // The same statement: a check often has a number and no name. "Transaction" was 44% of spending.
  it("names a check with no payee by its number", () => {
    const row = (fields: string) =>
      `<OFX><STMTTRN><TRNTYPE>CHECK<DTPOSTED>20261001<TRNAMT>-950.00<FITID>a${fields}</STMTTRN></OFX>`;
    const read = (fields: string) => {
      const result = readOfx({ name: "a.ofx", text: row(fields) });
      if (!result.ok) throw new Error(result.error);
      return result.transactions[0];
    };
    expect(read("<CHECKNUM>2205")).toMatchObject({
      description: "CHECK 2205",
      merchantName: "Check",
    });
    expect(read("")).toMatchObject({ description: "CHECK", merchantName: "Check" });
    expect(read("<CHECKNUM>2205<NAME>JOE SMITH").description).toBe("JOE SMITH");
  });

  it("reads the line from MEMO when NAME is its start", () => {
    const block = (name: string, memo: string) => `<OFX><STMTRS><STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261001120000
<TRNAMT>-9.50
<FITID>1
<NAME>${name}
<MEMO>${memo}
</STMTTRN></STMTRS></OFX>`;
    const read = (name: string, memo: string) => {
      const result = readOfx({ name: "a.ofx", text: block(name, memo) });
      return result.ok ? result.transactions[0] : null;
    };
    expect(
      read(
        "PURCHASE AUTHORIZED ON 09/30 SUN",
        "PURCHASE AUTHORIZED ON 09/30 SUNRISE DONUT AUSTIN TX",
      ),
    ).toMatchObject({
      description: "PURCHASE AUTHORIZED ON 09/30 SUNRISE DONUT AUSTIN TX",
      merchantName: "Sunrise Donut",
    });
    // A MEMO that's something else stays beside the merchant's NAME.
    expect(read("SUNRISE DONUT", "CARD 1234")).toMatchObject({
      description: "SUNRISE DONUT CARD 1234",
      merchantName: "Sunrise Donut",
    });
  });
});
