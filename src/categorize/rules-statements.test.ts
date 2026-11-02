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

// Debugger 11-02: paying a card from checking, as issuers write it. With no card file to pair it
// with, each counted as spending ($1,200 for one person on "CAPITAL ONE CRCARDPMT").
describe("a card payment on a checking statement", () => {
  it.each([
    "CAPITAL ONE CRCARDPMT",
    "ELECTRONIC PMT-WEB, CAPITAL ONE CRCARDPMT",
    "CAPITAL ONE PAYMENT",
    "WELLS FARGO CARD CCPYMT",
    "BK OF AMER VI/MC ONLINE PMT",
    "CITI CARD ONLINE TYPE: BILL PAY",
    "CHASE CARD EPAY",
    "DISCOVER CARD E-PAYMENT",
    "BARCLAYCARD US CREDITCARD",
    "TARGET CARD SRVC PAYMENT",
    "KOHLS PAYMENT",
    "SYNCB PAYMENT",
    "CREDIT ONE BANK PAYMENT",
    "MERRICK BANK PAYMENT",
    "CARDMEMBER SERV WEB PYMT",
    "NAVY FEDERAL CREDIT CARD PMT",
    // Store cards, which name the shop: "AMAZON" alone made these shopping (debugger 11-02: $1,200
    // on top of the card's own purchases, and listed as a regular bill).
    "SYNCHRONY BANK AMAZON PAYMENT",
    "AMAZON CORP SYF PAYMNT",
    "AMZ_STORECRD_PMT PAYMENT",
    "AMAZON STORE CARD PAYMENT",
    "SYNCHRONY BANK LOWES PAYMENT",
    "SYNCB/AMAZON PAYMENT",
    "LOWES SYF PAYMNT",
    "COMENITY PAY VI WEB PYMT",
    "COMENITY BANK PAYMENT",
    "BEST BUY CBNA PAYMENT",
    "TARGET CARD PAYMENT",
    "HOME DEPOT CREDIT SERVICES PAYMENT",
    "MACYS CREDIT CARD PAYMENT",
  ])("%s isn't spending", (description) => {
    expect(categorizeByRules({ description, amountCents: 30_000, hints: {} })?.detailed).toBe(
      "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    );
  });

  it.each([
    ["TARGET T-1234 CHERRY HILL NJ", "GENERAL_MERCHANDISE_SUPERSTORES"],
    ["KOHLS 0442 MARLTON NJ", "GENERAL_MERCHANDISE_DEPARTMENT_STORES"],
    ["CAPITAL ONE AUTO CARPAY", "LOAN_PAYMENTS_CAR_PAYMENT"],
    ["AMAZON.COM*RT4Y1 SEATTLE WA", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
    ["AMZN MKTP US*2K4", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
    ["SYNCHRONY BANK SAVINGS TRANSFER", "TRANSFER_OUT_SAVINGS"],
  ])("%s stays what it is", (description, category) => {
    expect(categorizeByRules({ description, amountCents: 3_000, hints: {} })?.detailed).toBe(
      category,
    );
  });
});

// Debugger 11-02: money sent to family abroad matched no rule, so Jane said "I'm not sure what they
// were" about it and listed it as a bill. It's money sent to someone, as Zelle to a person is.
describe("money sent through a remittance service", () => {
  it.each([
    "REMITLY* REMITTANCE 888-736-4859 WA",
    "XOOM A PAYPAL SERVICE 877-225-1456 CA",
    "WESTERN UNION 800-325-6000 GA",
    "WU DIGITAL WESTERN UNION",
    "MONEYGRAM US 800-666-3947",
    "WORLDREMIT LTD",
    "RIA FINANCIAL SERVICES",
    "SENDWAVE",
    "TRANSFERWISE INC",
    "WISE US INC",
  ])("%s is a transfer out", (description) => {
    expect(categorizeByRules({ description, amountCents: 40_000, hints: {} })?.detailed).toBe(
      "TRANSFER_OUT_ACCOUNT_TRANSFER",
    );
  });

  it.each(["WISE SONS DELICATESSEN", "OTHERWISE BOOKS", "RIA'S CAFE", "XOOMER HAIR SALON"])(
    "%s isn't one",
    (description) => {
      expect(categorizeByRules({ description, amountCents: 4_000, hints: {} })?.detailed).not.toBe(
        "TRANSFER_OUT_ACCOUNT_TRANSFER",
      );
    },
  );

  it("leaves money coming back from one alone", () => {
    expect(
      categorizeByRules({ description: "REMITLY REFUND", amountCents: -40_000, hints: {} })
        ?.detailed,
    ).not.toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
  });
});

// Debugger 11-02: a design agency's $4,200 invoice paid by "Halcyon Coffee" was a coffee refund, so it
// took $7,150 off their spending. Money in with no category isn't a refund (src/insights/spending.ts).
describe("a big deposit from a name that sounds like a shop", () => {
  it.each([
    ["HALCYON COFFEE", -420_000],
    ["JOES PIZZA ACH INVOICE", -250_000],
    ["SUNRISE SALON", -60_000],
  ])("%s isn't a refund", (description, amountCents) => {
    expect(categorizeByRules({ description, amountCents, hints: {} })).toBeNull();
  });

  it.each([
    ["HALCYON COFFEE", -650, "FOOD_AND_DRINK_COFFEE"],
    ["HALCYON COFFEE", 650, "FOOD_AND_DRINK_COFFEE"],
    ["JOES PIZZA", -3_200, "FOOD_AND_DRINK_RESTAURANT"],
  ])("%s for %i is still what it was", (description, amountCents, detailed) => {
    expect(categorizeByRules({ description, amountCents, hints: {} })?.detailed).toBe(detailed);
  });

  it("leaves a big refund for something that can cost that much", () => {
    expect(
      categorizeByRules({ description: "DELTA AIR LINES", amountCents: -60_000, hints: {} })
        ?.detailed,
    ).toBe("TRAVEL_FLIGHTS");
  });
});
