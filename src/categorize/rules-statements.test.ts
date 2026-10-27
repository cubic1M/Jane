import { describe, expect, it } from "vitest";
import { categorizeByRules } from "./rules";

// What bank statement uploads say, from the overnight upload QA (2026-10-27): rent by Zelle,
// moving money to savings, ATM fees, and loan payments.

const out = (description: string) =>
  categorizeByRules({ description, amountCents: 10_000, hints: {} })?.detailed ?? null;
const into = (description: string) =>
  categorizeByRules({ description, amountCents: -10_000, hints: {} })?.detailed ?? null;

describe("rules for statement uploads", () => {
  it("counts rent paid by Zelle or Venmo as rent", () => {
    expect(out("ZELLE TO OAK RIDGE APTS RENT")).toBe("RENT_AND_UTILITIES_RENT");
    expect(out("ZELLE PAYMENT TO MAPLE PROPERTY MGMT")).toBe("RENT_AND_UTILITIES_RENT");
    expect(out("VENMO PAYMENT JOHN SMITH RENT")).toBe("RENT_AND_UTILITIES_RENT");
    // A payment to a friend stays a transfer.
    expect(out("ZELLE TO JOHN SMITH")).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
  });

  it("doesn't take a rental car or clothes for rent", () => {
    expect(out("ENTERPRISE RENT-A-CAR")).toBe("TRAVEL_RENTAL_CARS");
    expect(out("HERTZ RENT A CAR SFO")).toBe("TRAVEL_RENTAL_CARS");
    expect(out("RENT THE RUNWAY")).toBe("GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES");
    expect(out("CURRENT BILL PARENT PORTAL")).not.toBe("RENT_AND_UTILITIES_RENT");
  });

  it("knows money moved to and from savings", () => {
    expect(out("TRANSFER TO SAV XXXXX4410")).toBe("TRANSFER_OUT_SAVINGS");
    expect(out("ONLINE TRANSFER TO SAVINGS")).toBe("TRANSFER_OUT_SAVINGS");
    expect(into("TRANSFER FROM SAV XXXXX4410")).toBe("TRANSFER_IN_SAVINGS");
  });

  it("calls an ATM fee a fee, not cash", () => {
    expect(out("ATM WITHDRAWAL NON-BANK FEE")).toBe("BANK_FEES_ATM_FEES");
    expect(out("ATM WITHDRAWAL FEE")).toBe("BANK_FEES_ATM_FEES");
    expect(out("ATM WITHDRAWAL 1234 MAIN ST")).toBe("TRANSFER_OUT_WITHDRAWAL");
  });

  it("knows mortgage, student loan and car loan payments", () => {
    expect(out("MORTGAGE PMT ROCKET MORTGAGE")).toBe("LOAN_PAYMENTS_MORTGAGE_PAYMENT");
    expect(out("NAVIENT DES:PAYMENT")).toBe("LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
    expect(out("TOYOTA FINANCIAL SVCS")).toBe("LOAN_PAYMENTS_CAR_PAYMENT");
  });

  it("knows pay however the bank or payroll company writes it", () => {
    for (const d of [
      "DIRECT DEPOSIT ACME CORP",
      "ACME CORP DIRECT DEPOSIT",
      "GUSTO PAY 123456 ACME INC",
      "PAYCHEX TPS DEPOSIT",
      "ADP WAGE PAY",
      "RIPPLING PAY",
    ])
      expect(into(d), d).toBe("INCOME_SALARY");
    // Paying a payroll company isn't pay.
    expect(out("GUSTO PAYROLL FEE")).not.toBe("INCOME_SALARY");
  });

  it("calls cash and cheques paid in a deposit", () => {
    expect(into("MOBILE DEPOSIT")).toBe("TRANSFER_IN_DEPOSIT");
    expect(into("ATM CASH DEPOSIT 1234 MAIN ST")).toBe("TRANSFER_IN_DEPOSIT");
  });
});
