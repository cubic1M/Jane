import { describe, expect, it } from "vitest";
import {
  chaseCreditCard,
  debitCreditCents,
  detectFormat,
  parseIsoDate,
  parseShortUsDate,
  parseUsDate,
} from "./formats";

describe("parseUsDate", () => {
  it("converts MM/DD/YYYY to an ISO date", () => {
    expect(parseUsDate("10/03/2026")).toBe("2026-10-03");
    expect(parseUsDate("1/3/2026")).toBe("2026-01-03");
  });

  it("rejects impossible or differently formatted dates", () => {
    expect(parseUsDate("02/30/2026")).toBeNull();
    expect(parseUsDate("13/01/2026")).toBeNull();
    expect(parseUsDate("2026-10-03")).toBeNull();
    expect(parseUsDate("")).toBeNull();
  });
});

describe("other date layouts", () => {
  it("reads MM/DD/YY as 20YY and YYYY-MM-DD as it is", () => {
    expect(parseShortUsDate("09/28/26")).toBe("2026-09-28");
    expect(parseShortUsDate("09/28/2026")).toBeNull();
    expect(parseIsoDate("2026-09-28")).toBe("2026-09-28");
    expect(parseIsoDate("2026-02-30")).toBeNull();
  });
});

describe("debitCreditCents", () => {
  it("reads money out minus money in, whatever sign each column uses", () => {
    expect(debitCreditCents("12.50", "")).toBe(1250);
    expect(debitCreditCents("", "500.00")).toBe(-50000);
    expect(debitCreditCents("", "-500.00")).toBe(-50000);
    expect(debitCreditCents("", "")).toBe("Missing amount");
    expect(debitCreditCents("abc", "")).toBe('Unreadable amount "abc"');
  });
});

describe("detectFormat", () => {
  it("recognizes Chase headers regardless of case and spacing", () => {
    expect(
      detectFormat([
        " details",
        "POSTING DATE",
        "Description",
        "Amount",
        "Type",
        "Balance",
        "Check or Slip #",
      ])?.id,
    ).toBe("chase_checking");
    expect(
      detectFormat(["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount"])
        ?.id,
    ).toBe("chase_credit_card");
  });

  it("tells the new banks' headers apart", () => {
    const id = (header: string) => detectFormat(header.split(","))?.id;
    expect(id("Date,Description,Amount,Running Bal.")).toBe("bofa_checking");
    expect(id("Posted Date,Reference Number,Payee,Address,Amount")).toBe("bofa_credit_card");
    expect(id("Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit")).toBe(
      "capital_one_credit_card",
    );
    expect(
      id(
        "Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance",
      ),
    ).toBe("capital_one_360");
    expect(id("Status,Date,Description,Debit,Credit")).toBe("citi_credit_card");
    expect(id("Status,Date,Description,Debit,Credit,Member Name")).toBe("citi_credit_card");
    expect(id("Date,Description,Card Member,Account #,Amount")).toBe("amex");
    expect(id("Trans. Date,Post Date,Description,Amount,Category")).toBe("discover_credit_card");
  });

  it("returns null for unknown headers", () => {
    expect(detectFormat(["Date", "Payee", "Debit", "Credit"])).toBeNull();
  });
});

describe("chaseCreditCard.parseRow", () => {
  const row = (values: Record<string, string>) => (header: string) => values[header] ?? "";

  it("requires a description", () => {
    expect(
      chaseCreditCard.parseRow(
        row({ "post date": "10/01/2026", amount: "-1.00", description: " " }),
      ),
    ).toEqual({ ok: false, reason: "Missing description" });
  });
});
