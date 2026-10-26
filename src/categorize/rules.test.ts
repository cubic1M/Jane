import { describe, expect, it } from "vitest";
import { categorizeByRules } from "./rules";
import { ALL_DETAILED, categoryOf } from "./taxonomy";

const out = (description: string, hints = {}) =>
  categorizeByRules({ description, amountCents: 1000, hints })?.detailed ?? null;
const into = (description: string, hints = {}) =>
  categorizeByRules({ description, amountCents: -1000, hints })?.detailed ?? null;

describe("categorizeByRules", () => {
  it.each([
    ["NETFLIX.COM NETFLIX.COM CA 10/14", "ENTERTAINMENT_TV_AND_MOVIES"],
    ["Spotify USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
    ["SQ *BLUE BOTTLE COFFEE #123 OAKLAND CA", "FOOD_AND_DRINK_COFFEE"],
    ["WHOLEFDS MKT 10234", "FOOD_AND_DRINK_GROCERIES"],
    ["UBER   *TRIP HELP.UBER.COM CA", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"],
    ["UBER EATS 8005928996", "FOOD_AND_DRINK_RESTAURANT"],
    ["AMZN Mktp US*2K4L91RT0", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
    ["GEICO *AUTO 800-841-3000 DC", "GENERAL_SERVICES_INSURANCE"],
    ["T-MOBILE AUTO PAY", "RENT_AND_UTILITIES_TELEPHONE"],
    ["MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"],
    ["NON-CHASE ATM FEE-WITH", "BANK_FEES_ATM_FEES"],
    ["OVERDRAFT FEE FOR A $40.00 ITEM", "BANK_FEES_OVERDRAFT_FEES"],
    ["PURCHASE INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE"],
    ["CASH ADVANCE INTEREST CHARGE", "BANK_FEES_CASH_ADVANCE"],
    ["LATE FEE", "BANK_FEES_LATE_FEES"],
    ["FOREIGN TRANSACTION FEE", "BANK_FEES_FOREIGN_TRANSACTION_FEES"],
    ["Payment to Chase card ending in 1234 10/07", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["Zelle payment to Sam Example JPM99a1b2c3d", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
  ])("puts outgoing %j in %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  it.each([
    ["ACME CORP PAYROLL PPD ID: 9876543210", "INCOME_SALARY"],
    ["INTEREST PAYMENT", "INCOME_INTEREST_EARNED"],
    ["Zelle payment from Sam Example", "TRANSFER_IN_ACCOUNT_TRANSFER"],
    ["Payment Thank You-Mobile", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
  ])("puts incoming %j in %s", (description, category) => {
    expect(into(description)).toBe(category);
  });

  it("respects direction: payroll going out is not income", () => {
    expect(out("PAYROLL SERVICE CO")).toBeNull();
  });

  it("matches whole words only", () => {
    expect(out("TUBER FARMS")).toBeNull();
    expect(out("TARGETED ADS LLC")).toBeNull();
  });

  it("falls back to the bank's own labels", () => {
    expect(out("SOMETHING", { bankType: "FEE_TRANSACTION" })).toBe("BANK_FEES_OTHER_BANK_FEES");
    expect(out("CORNER MARKET", { bankCategory: "Groceries" })).toBe("FOOD_AND_DRINK_GROCERIES");
    expect(into("CORNER MARKET", { bankCategory: "Groceries" })).toBeNull();
  });

  // Messy-bank QA: what real checking accounts and card exports write.
  it.each([
    ["CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["AMEX EPAYMENT ACH PMT W4562", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["CAPITAL ONE ONLINE PMT 9F2K", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["DISCOVER E-PAYMENT 7731", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
    ["RIVERSIDE PROPERTY MGMT RENT PPD ID: 5550001", "RENT_AND_UTILITIES_RENT"],
    ["PG&E WEB ONLINE PPD ID: 9471234567", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"],
    ["SQ *JOES COFFEE 4421", "FOOD_AND_DRINK_COFFEE"],
  ])("puts the messy outgoing %j in %s", (description, category) => {
    expect(out(description)).toBe(category);
  });

  it("never files a car rental as rent", () => {
    expect(out("ENTERPRISE RENT-A-CAR 1234")).not.toBe("RENT_AND_UTILITIES_RENT");
  });

  it("counts Social Security and a pension as income", () => {
    expect(into("SSA TREAS 310 XXSOC SEC")).toBe("INCOME_RETIREMENT_PENSION");
    expect(into("STATE TEACHERS RETIREMENT SYS PENSION")).toBe("INCOME_RETIREMENT_PENSION");
    expect(out("PENSION SERVICES LLC")).toBeNull();
  });

  it("files ticket sellers as events, even under the card's own category", () => {
    const events = "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS";
    expect(out("TICKETMASTER 800-653-8000", { bankCategory: "Entertainment" })).toBe(events);
    expect(out("STUBHUB 866-788-2482")).toBe(events);
    expect(out("CITY PARKING TICKETS")).toBeNull();
  });

  it("counts a payout for one's own work as income, not a refund", () => {
    expect(into("STRIPE TRANSFER ST-K3J9Q2 PPD ID: 4270465600")).toBe("INCOME_CONTRACTOR");
    expect(out("STRIPE TRANSFER ST-K3J9Q2")).toBeNull();
  });

  it("uses a card's own categories, both ways, so a return nets against its purchase", () => {
    const shop = { bankCategory: "Shopping" };
    expect(out("BEST BUY 00012345", shop)).toBe("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE");
    expect(into("BEST BUY 00012345", shop)).toBe("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE");
    expect(out("TST* SHAKE SHACK 1234", { bankCategory: "Food & Drink" })).toBe(
      "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
    );
    // A keyword still wins over the card's broad label.
    expect(out("NETFLIX.COM", { bankCategory: "Shopping" })).toBe("ENTERTAINMENT_TV_AND_MOVIES");
  });

  it("leaves unknown merchants for the LLM", () => {
    expect(out("MYSTERY SHOP 555")).toBeNull();
  });

  it("returns primary and detailed together", () => {
    expect(categorizeByRules({ description: "NETFLIX", amountCents: 1549, hints: {} })).toEqual({
      primary: "ENTERTAINMENT",
      detailed: "ENTERTAINMENT_TV_AND_MOVIES",
    });
  });
});

describe("taxonomy", () => {
  it("names every detailed category after its primary", () => {
    for (const detailed of ALL_DETAILED) {
      expect(detailed.startsWith(`${categoryOf(detailed)?.primary}_`)).toBe(true);
    }
  });

  it("rejects names outside the taxonomy", () => {
    expect(categoryOf("SUBSCRIPTIONS")).toBeNull();
  });

  it("is Plaid's PFCv2 list, including the v2 renames", () => {
    expect(ALL_DETAILED).toHaveLength(127);
    expect(categoryOf("INCOME_SALARY")?.primary).toBe("INCOME");
    expect(categoryOf("LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT")?.primary).toBe("LOAN_DISBURSEMENTS");
    expect(categoryOf("BANK_FEES_LATE_FEES")?.primary).toBe("BANK_FEES");
    expect(categoryOf("INCOME_WAGES")).toBeNull();
  });
});
