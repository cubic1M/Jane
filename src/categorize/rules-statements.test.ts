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

// Debugger 11-02: "CA EDD UI DIRECT DEP" hit the salary rule's DIRECT DEP first, so someone laid off
// read "Your employer: CA EDD UI DIRECT DEP" and "How you're paid: salary, 92% sure", and nothing
// noticed their pay had stopped.
describe("unemployment benefits", () => {
  it.each([
    "CA EDD UI DIRECT DEP",
    "EDD UI BENEFITS",
    "NYS DOL UI DD",
    "NYS DOL UI DIRECT DEP",
    "DEPT OF LABOR UI BENEFIT",
    "TX WORKFORCE COMM UI DIRECT DEP",
    "UNEMPLOYMENT INS DIRECT DEPOSIT",
    "STATE OF WA ESD UI PAYMENT",
  ])("%s isn't a salary", (description) => {
    expect(categorizeByRules({ description, amountCents: -45_000, hints: {} })?.detailed).toBe(
      "INCOME_UNEMPLOYMENT",
    );
  });

  it.each([
    ["ACME LOGISTICS INC PAYROLL", "INCOME_SALARY"],
    ["BRIGHTLINE UI DESIGN PAYROLL", "INCOME_SALARY"],
    ["ACME DIRECT DEP", "INCOME_SALARY"],
  ])("%s stays pay", (description, detailed) => {
    expect(categorizeByRules({ description, amountCents: -260_000, hints: {} })?.detailed).toBe(
      detailed,
    );
  });

  it("is only money coming in", () => {
    expect(
      categorizeByRules({ description: "EDD UI OVERPAYMENT", amountCents: 45_000, hints: {} })
        ?.detailed,
    ).not.toBe("INCOME_UNEMPLOYMENT");
  });
});

describe("other pay that says DIRECT DEP", () => {
  it.each([
    ["DFAS CLEVELAND MIL PAY DIRECT DEP", "INCOME_MILITARY"],
    ["VA BENEFITS DIRECT DEP", "INCOME_MILITARY"],
    ["CHILD SUPPORT DIRECT DEP", "INCOME_CHILD_SUPPORT"],
  ])("%s isn't a salary", (description, detailed) => {
    expect(categorizeByRules({ description, amountCents: -90_000, hints: {} })?.detailed).toBe(
      detailed,
    );
  });
});

describe("severance", () => {
  it("is income, and not a salary", () => {
    expect(
      categorizeByRules({
        description: "ACME LOGISTICS INC SEVERANCE",
        amountCents: -1_200_000,
        hints: {},
      })?.detailed,
    ).toBe("INCOME_OTHER");
  });
});

// Debugger 11-02: a car dealer's $8,000 down payment was gas and electricity, for "PUGET SOUND".
describe("a name that starts like a utility's", () => {
  it.each(["PUGET SOUND TOYOTA DOWN PMT", "PUGET SOUND BLOOD CENTER"])(
    "%s isn't one",
    (description) => {
      expect(
        categorizeByRules({ description, amountCents: 800_000, hints: {} })?.detailed,
      ).not.toBe("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY");
    },
  );

  it.each(["PUGET SOUND ENERGY", "PUGET SOUND ENERGY BILL PAY"])("%s is", (description) => {
    expect(categorizeByRules({ description, amountCents: 12_000, hints: {} })?.detailed).toBe(
      "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    );
  });
});
// Debugger 11-02: of 55 ways banks write a move between a person's own accounts, 12 matched nothing.
// Money out with no category counts as spending, so a $1,000 move to savings read as $1,000 spent.
describe("a move between a person's own accounts", () => {
  it.each([
    "EXT TRNSFR TO ALLY BANK",
    "ACH TRNSFR ALLY BANK SAVINGS",
    "TRF TO 4471",
    "CAPITAL ONE 360 XFER",
    "PAYPAL INST XFER",
    "APPLE CASH SENT MONEY",
  ])("%s isn't spending", (description) => {
    expect(categorizeByRules({ description, amountCents: 100_000, hints: {} })?.primary).toBe(
      "TRANSFER_OUT",
    );
  });

  it("paying an Apple Card through Goldman Sachs isn't spending", () => {
    expect(
      categorizeByRules({
        description: "GOLDMAN SACHS BANK APPLE CARD",
        amountCents: 100_000,
        hints: {},
      })?.detailed,
    ).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });

  it.each([
    "EXT TRNSFR FROM ALLY BANK",
    "ACH TRNSFR ALLY BANK CHECKING",
    "SCHWAB BROKERAGE MONEYLINK",
    "VANGUARD SELL INVESTMENT",
    "WEALTHFRONT EDI PYMNTS",
  ])("%s isn't income or a refund", (description) => {
    expect(categorizeByRules({ description, amountCents: -100_000, hints: {} })?.primary).toBe(
      "TRANSFER_IN",
    );
  });

  it.each([
    ["TRF TO 4471 WIDGETS LLC", "out"],
    ["XFERMODE SOFTWARE", "out"],
    ["WEALTHFRONT ADVISER FEE", "out"],
  ])("doesn't catch a name like %s", (description) => {
    expect(categorizeByRules({ description, amountCents: 4_000, hints: {} })?.primary).not.toBe(
      "TRANSFER_IN",
    );
  });
});

// Debugger 11-02: of 47 ways banks write pay and benefits, these matched nothing or the wrong thing.
// Someone living on SSI or VA benefits read as having no income at all.
describe("pay and benefits, as banks write them", () => {
  it.each([
    ["SSI TREAS 310", "INCOME_RETIREMENT_PENSION"],
    ["VA TREAS 310 VETERANS", "INCOME_MILITARY"],
    ["NY STATE TEACHERS RET", "INCOME_RETIREMENT_PENSION"],
    ["ACME CORP PAYRLL", "INCOME_SALARY"],
    ["ACME CORP PR PAYMENT", "INCOME_SALARY"],
    ["LYFT DIRECT DEP", "INCOME_GIG_ECONOMY"],
    ["UBER DIRECT DEP", "INCOME_GIG_ECONOMY"],
  ])("%s is %s", (description, detailed) => {
    expect(categorizeByRules({ description, amountCents: -120_000, hints: {} })?.detailed).toBe(
      detailed,
    );
  });

  it("doesn't take a purchase for pay", () => {
    expect(
      categorizeByRules({ description: "LYFT RIDE", amountCents: 2_400, hints: {} })?.primary,
    ).not.toBe("INCOME");
  });
});

// Debugger 11-02: how Planet Fitness writes itself on a card; Chase calls it Health & Wellness, so it
// was medical care, and no subscription to review.
describe("a gym, as a card statement writes it", () => {
  it.each(["PLANET FIT CLUB FEES", "PLANET FIT BLACK CARD"])("%s isn't medical", (description) => {
    const result = categorizeByRules({
      description,
      amountCents: 2_499,
      hints: { bankCategory: "Health & Wellness" },
    });
    expect(result?.detailed).toBe("PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS");
  });
});

// Debugger 11-03: a retiree's two health premiums, $387 a month, sat uncategorized.
describe("a retiree's health premiums, as banks write them", () => {
  it.each([
    "MEDICARE PREMIUM CMS MED INS",
    "CMS MEDICARE PREM",
    "AARP UHC SUPPLEMENT INS PREM",
    "UHC MEDICARE SUPPLEMENT",
  ])("%s is insurance", (description) => {
    expect(categorizeByRules({ description, amountCents: 17_470, hints: {} })?.detailed).toBe(
      "GENERAL_SERVICES_INSURANCE",
    );
  });

  it("doesn't take a membership for insurance", () => {
    expect(
      categorizeByRules({ description: "AARP MEMBERSHIP", amountCents: 1_600, hints: {} })
        ?.detailed,
    ).not.toBe("GENERAL_SERVICES_INSURANCE");
  });
});

// Debugger 11-03: a student's loan money, as servicers write it, matched nothing: never income, but
// a question Jane shouldn't need to ask.
describe("a student loan's money arriving", () => {
  it.each([
    "FEDLOAN DISBURSEMENT TO STUDENT",
    "SALLIE MAE DISBURSEMENT REFUND",
    "NELNET LOAN DISB",
    "MOHELA DISBURSEMENT",
  ])("%s is a student loan disbursement", (description) => {
    expect(categorizeByRules({ description, amountCents: -275_000, hints: {} })?.detailed).toBe(
      "LOAN_DISBURSEMENTS_STUDENT",
    );
  });

  it("doesn't take a payment to the servicer for money arriving", () => {
    expect(
      categorizeByRules({ description: "SALLIE MAE PAYMENT", amountCents: 18_000, hints: {} })
        ?.detailed,
    ).not.toBe("LOAN_DISBURSEMENTS_STUDENT");
  });
});
