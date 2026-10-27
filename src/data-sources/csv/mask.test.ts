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
});
