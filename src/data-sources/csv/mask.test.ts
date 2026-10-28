import { describe, expect, it } from "vitest";
import { statementMask } from "./mask";

describe("statementMask", () => {
  it("reads an OFX/QFX file's account number", () => {
    expect(
      statementMask(
        "Checking.qfx",
        "OFXHEADER:100\n<OFX><BANKACCTFROM><ACCTID>000-004321<ACCTTYPE>CHECKING",
      ),
    ).toBe("4321");
  });

  it("reads Capital One's Card No. and Amex's Account # columns", () => {
    expect(
      statementMask(
        "download.csv",
        "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-10-01,2026-10-02,1234,HULU,Ent,17.99,",
      ),
    ).toBe("1234");
    expect(
      statementMask(
        "activity.csv",
        "Date,Description,Card Member,Account #,Amount\n10/01/2026,NETFLIX,SAM,-12345,22.99",
      ),
    ).toBe("2345");
  });

  it("finds four digits in the name that aren't a year or a date", () => {
    expect(statementMask("Chase4321_Activity_20261027.CSV", "Details,Posting Date\n")).toBe("4321");
    expect(statementMask("September2026_1234.csv", "Posted Date,Payee\n")).toBe("1234");
    expect(statementMask("2026-10-27_transaction_download.csv", "Date,Description\n")).toBeNull();
    expect(statementMask("export (3).csv", "Date,Description\n")).toBeNull();
  });

  it("reads a file whose start cuts through a quoted field, and never throws", () => {
    // Amex: an address in quotes over two lines, far enough down that the read of the start
    // ends inside it.
    const row = (i: number) =>
      `10/${String((i % 28) + 1).padStart(2, "0")}/2026,UBER EATS,SAM,-12345,26.77,,UBER EATS,,"OAKLAND\nCA",94612`;
    const amex = [
      "Date,Description,Card Member,Account #,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code",
      ...Array.from({ length: 80 }, (_, i) => row(i)),
    ].join("\n");
    expect(statementMask("activity.csv", amex)).toBe("2345");

    // Wells Fargo: every field quoted, no header.
    const wells = Array.from(
      { length: 80 },
      () => '"10/24/2026","-49.76","*","","PURCHASE AUTHORIZED ON 10/24 SAFEWAY #1234 OAKLAND CA"',
    ).join("\n");
    expect(() => statementMask("wells-fargo.csv", wells)).not.toThrow();

    // Broken all the way through: no mask, not a failed upload.
    expect(statementMask("broken.csv", 'Date,Description\n10/01/2026,"NETFLIX')).toBeNull();
  });
});
